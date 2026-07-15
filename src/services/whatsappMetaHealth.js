const { waLog } = require('../utils/whatsappLog');

function isMetaWhatsAppEnabled() {
  return (
    String(process.env.WHATSAPP_ENABLED || '').toLowerCase() === 'true' &&
    String(process.env.WHATSAPP_PROVIDER || 'meta').toLowerCase() === 'meta' &&
    Boolean(process.env.WHATSAPP_CLOUD_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID)
  );
}

function extractWabaId(healthStatus) {
  const entities = Array.isArray(healthStatus?.entities) ? healthStatus.entities : [];
  const waba = entities.find((e) => e?.entity_type === 'WABA' && e?.id);
  return waba ? String(waba.id) : null;
}

function summarizeHealthEntities(healthStatus) {
  const entities = Array.isArray(healthStatus?.entities) ? healthStatus.entities : [];
  return entities.map((entity) => ({
    type: entity.entity_type,
    id: entity.id,
    canSend: entity.can_send_message,
    errors: entity.errors,
    info: entity.additional_info,
  }));
}

/**
 * Meta WhatsApp başlangıç teşhisi:
 * - WABA → App aboneliği (webhook + teslimat için zorunlu)
 * - health_status uyarıları (işletme doğrulama, display name vb.)
 * - Gönderimde kullanılan şablonların APPROVED olup olmadığı
 */
async function runMetaWhatsAppStartupHealthCheck() {
  if (!isMetaWhatsAppEnabled()) return { skipped: true, reason: 'whatsapp_not_meta' };

  const token = process.env.WHATSAPP_CLOUD_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const version = process.env.WHATSAPP_GRAPH_VERSION || 'v21.0';
  const headers = { Authorization: `Bearer ${token}` };

  try {
    const healthRes = await fetch(
      `https://graph.facebook.com/${version}/${phoneNumberId}?fields=health_status,verified_name,name_status`,
      { headers }
    );
    const healthJson = await healthRes.json().catch(() => ({}));
    const healthStatus = healthJson?.health_status;
    const wabaId = extractWabaId(healthStatus);

    if (!healthRes.ok) {
      waLog('⚠️', 'Meta health_status alınamadı', {
        status: healthRes.status,
        error: healthJson?.error?.message,
      });
      return { ok: false, reason: 'health_fetch_failed' };
    }

    const entitySummary = summarizeHealthEntities(healthStatus);
    const limited = entitySummary.filter((e) => e.canSend && e.canSend !== 'AVAILABLE');

    if (limited.length > 0) {
      waLog('⚠️', 'Meta WhatsApp gönderim kısıtlı — mesajlar kabul edilip teslim edilmeyebilir', {
        verifiedName: healthJson?.verified_name,
        nameStatus: healthJson?.name_status,
        entities: limited,
        actions: [
          'Meta Business Settings → Security Center → Business verification tamamlayın',
          'WhatsApp Manager → Phone numbers → Display name onayını bekleyin',
          'WhatsApp Manager → Billing → ödeme yöntemi ekleyin (hata 131042)',
          'https://business.facebook.com/billing_hub/',
        ],
      });
    }

    if (!wabaId) {
      waLog('⚠️', 'Meta WABA ID health_status içinde bulunamadı', { entitySummary });
      return { ok: true, wabaId: null, entitySummary };
    }

    const configuredTemplates = [
      process.env.WHATSAPP_TEMPLATE_BOOKING_BUSINESS_NAME,
      process.env.WHATSAPP_TEMPLATE_BOOKING_CUSTOMER_NAME,
      process.env.WHATSAPP_TEMPLATE_RSVP_24H_NAME,
      process.env.WHATSAPP_TEMPLATE_RSVP_1H_NAME,
      process.env.WHATSAPP_TEMPLATE_RSVP_NAME,
      process.env.WHATSAPP_TEMPLATE_RSVP_BUSINESS_NAME,
    ]
      .map((n) => String(n || '').trim())
      .filter(Boolean);
    const expectedLang = process.env.WHATSAPP_TEMPLATE_LANG || 'tr';

    if (configuredTemplates.length) {
      const tRes = await fetch(
        `https://graph.facebook.com/${version}/${wabaId}/message_templates?limit=100&fields=name,status,language,category,rejected_reason`,
        { headers }
      );
      const tJson = await tRes.json().catch(() => ({}));
      const remote = Array.isArray(tJson?.data) ? tJson.data : [];
      if (tRes.ok) {
        const issues = [];
        for (const name of [...new Set(configuredTemplates)]) {
          const matches = remote.filter((t) => t.name === name);
          if (!matches.length) {
            issues.push({ name, problem: 'not_found', hint: 'WhatsApp Manager’da şablon adını kontrol edin' });
            continue;
          }
          const langMatch = matches.find((t) => t.language === expectedLang) || matches[0];
          if (langMatch.language !== expectedLang) {
            issues.push({
              name,
              problem: 'language_mismatch',
              remoteLanguage: langMatch.language,
              expectedLang,
              status: langMatch.status,
            });
          } else if (langMatch.status !== 'APPROVED') {
            issues.push({
              name,
              problem: 'not_approved',
              status: langMatch.status,
              language: langMatch.language,
              category: langMatch.category,
              rejectedReason: langMatch.rejected_reason,
              hint:
                langMatch.status === 'PENDING'
                  ? 'Meta onayı bekleniyor — APPROVED olmadan API 132001 döner'
                  : 'Şablon APPROVED değil; reddedildiyse içeriği düzeltip yeniden gönderin',
            });
          }
        }
        if (issues.length) {
          waLog('❌', 'Meta şablonları gönderime hazır değil — WhatsApp mesajları başarısız olur', {
            expectedLang,
            issues,
            action: 'WhatsApp Manager → Message templates → her şablon APPROVED olmalı',
          });
        } else {
          waLog('✅', 'Meta randevu şablonları APPROVED', {
            templates: [...new Set(configuredTemplates)],
            language: expectedLang,
          });
        }
      } else {
        waLog('⚠️', 'Meta şablon listesi alınamadı', { error: tJson?.error?.message });
      }
    }

    const subsRes = await fetch(
      `https://graph.facebook.com/${version}/${wabaId}/subscribed_apps`,
      { headers }
    );
    const subsJson = await subsRes.json().catch(() => ({}));
    const subscribed = Array.isArray(subsJson?.data) ? subsJson.data : [];
    const appId = String(process.env.META_APP_ID || '1718361726170682');
    const alreadySubscribed = subscribed.some(
      (item) => String(item?.whatsapp_business_api_data?.id || item?.id) === appId
    );

    if (!alreadySubscribed) {
      waLog('🔧', 'WABA uygulamaya abone değil — abonelik ekleniyor', { wabaId, appId });
      const subRes = await fetch(
        `https://graph.facebook.com/${version}/${wabaId}/subscribed_apps`,
        { method: 'POST', headers }
      );
      const subJson = await subRes.json().catch(() => ({}));
      if (subJson?.success) {
        waLog('✅', 'WABA → App aboneliği eklendi (webhook teslimat logları aktif olmalı)', {
          wabaId,
          appId,
        });
      } else {
        waLog('❌', 'WABA → App aboneliği eklenemedi', {
          wabaId,
          appId,
          error: subJson?.error?.message,
          hint: 'Meta Business Manager → WhatsApp → API Setup → Configure webhooks',
        });
      }
    } else {
      waLog('✅', 'Meta WhatsApp hazır — WABA uygulamaya abone', {
        wabaId,
        canSend: healthStatus?.can_send_message,
      });
    }

    return {
      ok: true,
      wabaId,
      canSend: healthStatus?.can_send_message,
      entitySummary,
      subscribed: alreadySubscribed || Boolean(subscribed.length),
    };
  } catch (err) {
    waLog('⚠️', 'Meta startup health check hatası', { message: err?.message || String(err) });
    return { ok: false, reason: 'health_check_exception' };
  }
}

module.exports = {
  isMetaWhatsAppEnabled,
  runMetaWhatsAppStartupHealthCheck,
};
