/**
 * WhatsApp teşhis logları — sunucu konsolunda emoji ile adım adım izleme.
 */
function waLog(emoji, label, data) {
  if (data !== undefined) {
    console.log(`${emoji} [WA] ${label}`, data);
  } else {
    console.log(`${emoji} [WA] ${label}`);
  }
}

module.exports = { waLog };
