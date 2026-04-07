/**
 * Sabit UX verisi (alan → meslek). API /api/areas ve /api/professions ile sunulur.
 * Frontend `businessCategories.ts` ile aynı kapsamda tutulmalı.
 */

const AREAS = [
  'Sağlık',
  'Güzellik & Bakım',
  'Spor & Wellness',
  'Eğitim',
  'Danışmanlık & Hukuk',
  'Otomotiv',
  'Ev & Teknik Hizmet',
  'Hayvan Bakımı',
  'Yeme & İçme',
  'Turizm & Etkinlik',
  'Diğer',
];

const PROFESSIONS_BY_AREA = {
  Sağlık: [
    'Psikolog',
    'Psikiyatrist',
    'Diyetisyen',
    'Fizyoterapist',
    'Diş Hekimi',
    'Göz Doktoru',
    'Estetik Kliniği',
    'Tıbbi Laboratuvar',
    'Aile Hekimi / Genel Pratisyen',
    'Hemşirelik & Evde Sağlık',
    'Osteopat / Manuel Terapist',
  ],
  'Güzellik & Bakım': [
    'Kuaför',
    'Güzellik Uzmanı',
    'Lazer Epilasyon Merkezi',
    'Manikür & Pedikür',
    'Kirpik & Kaş Tasarımı',
    'Cilt Bakımı',
    'Masaj Salonu',
    'SPA & Hamam',
    'Kaş Microblading',
    'Profesyonel Makyaj',
  ],
  'Spor & Wellness': [
    'Pilates Eğitmeni',
    'Yoga Eğitmeni',
    'Fitness & Personal Trainer',
    'Yüzme Antrenörü',
    'Grup Ders Eğitmeni',
    'Beslenme & Spor Koçluğu',
  ],
  Eğitim: [
    'Özel Ders (İlköğretim / Lise)',
    'Özel Ders (Üniversite)',
    'Yabancı Dil Kursu',
    'Yazılım & IT Kursu',
    'Müzik Kursu',
    'Resim & Sanat Atölyesi',
    'Sürücü Kursu',
    'Halk Eğitim / Meslek Kursu',
  ],
  'Danışmanlık & Hukuk': [
    'Avukatlık',
    'Mali Müşavirlik',
    'İş & Yönetim Danışmanlığı',
    'İnsan Kaynakları Danışmanlığı',
    'Emlak Danışmanlığı',
    'Kariyer Koçluğu',
    'Yeminli Müşavirlik',
  ],
  Otomotiv: [
    'Oto Tamir & Mekanik Servis',
    'Oto Yıkama & Detay',
    'Lastik & Balans',
    'Araç Klima Servisi',
    'Kaporta & Boya',
    'Ekspertiz',
    'Oto Elektrik',
  ],
  'Ev & Teknik Hizmet': [
    'Elektrikçi',
    'Tesisatçı',
    'Klima Montaj & Bakım',
    'Uydu & İnternet Kurulum',
    'Marangoz',
    'Boyacı',
    'Çilingir',
    'Halı & Koltuk Yıkama',
    'Temizlik Hizmeti',
  ],
  'Hayvan Bakımı': [
    'Veteriner Kliniği',
    'Pet Kuaförü',
    'Köpek Eğitmeni',
    'Pet Otel & Pansiyon',
    'Pet Aşı & Sağlık Takibi',
    'Pet Bakım & Günlük İzleme',
  ],
  'Yeme & İçme': [
    'Restoran',
    'Cafe & Kahve',
    'Pastane & Fırın',
    'Catering & Davet Yemeği',
    'Fast Food',
  ],
  'Turizm & Etkinlik': [
    'Tekne Turu',
    'Dalış Merkezi',
    'Araç Kiralama',
    'Profesyonel Fotoğrafçı',
    'Düğün & Etkinlik Organizasyonu',
    'Konaklama & Pansiyon',
  ],
  Diğer: ['Diğer İşletme'],
};

/**
 * Meslek etiketi → businessType slug (Business model / filtreler).
 */
const PROFESSION_TO_BUSINESS_TYPE = {
  // Sağlık
  Psikolog: 'psychologist',
  Psikiyatrist: 'psychologist',
  Diyetisyen: 'dietitian',
  Fizyoterapist: 'physiotherapist',
  'Diş Hekimi': 'dental_clinic',
  'Göz Doktoru': 'eye_doctor',
  'Estetik Kliniği': 'aesthetic_clinic',
  'Tıbbi Laboratuvar': 'lab',
  'Aile Hekimi / Genel Pratisyen': 'other',
  'Hemşirelik & Evde Sağlık': 'other',
  'Osteopat / Manuel Terapist': 'physiotherapist',

  // Güzellik & Bakım
  Kuaför: 'hair_salon',
  'Güzellik Uzmanı': 'beauty_center',
  'Lazer Epilasyon Merkezi': 'laser_epilation',
  'Manikür & Pedikür': 'nail_salon',
  'Kirpik & Kaş Tasarımı': 'lash_brow',
  'Cilt Bakımı': 'skin_care',
  'Masaj Salonu': 'massage_salon',
  'SPA & Hamam': 'spa_hamam',
  'Kaş Microblading': 'lash_brow',
  'Profesyonel Makyaj': 'beauty_center',

  // Spor
  'Pilates Eğitmeni': 'pilates_yoga_instructor',
  'Yoga Eğitmeni': 'pilates_yoga_instructor',
  'Fitness & Personal Trainer': 'pilates_yoga_instructor',
  'Yüzme Antrenörü': 'pilates_yoga_instructor',
  'Grup Ders Eğitmeni': 'pilates_yoga_instructor',
  'Beslenme & Spor Koçluğu': 'dietitian',

  // Eğitim
  'Özel Ders (İlköğretim / Lise)': 'private_tutor',
  'Özel Ders (Üniversite)': 'private_tutor',
  'Yabancı Dil Kursu': 'language_course',
  'Yazılım & IT Kursu': 'software_course',
  'Müzik Kursu': 'private_tutor',
  'Resim & Sanat Atölyesi': 'private_tutor',
  'Sürücü Kursu': 'driving_school',
  'Halk Eğitim / Meslek Kursu': 'software_course',

  // Danışmanlık
  Avukatlık: 'other',
  'Mali Müşavirlik': 'other',
  'İş & Yönetim Danışmanlığı': 'other',
  'İnsan Kaynakları Danışmanlığı': 'other',
  'Emlak Danışmanlığı': 'other',
  'Kariyer Koçluğu': 'other',
  'Yeminli Müşavirlik': 'other',

  // Otomotiv
  'Oto Tamir & Mekanik Servis': 'auto_repair',
  'Oto Yıkama & Detay': 'car_wash',
  'Lastik & Balans': 'tire_shop',
  'Araç Klima Servisi': 'ac_service',
  'Kaporta & Boya': 'body_paint',
  Ekspertiz: 'auto_expert',
  'Oto Elektrik': 'auto_repair',

  // Ev & teknik
  Elektrikçi: 'electrician',
  Tesisatçı: 'plumber',
  'Klima Montaj & Bakım': 'ac_install_maint',
  'Uydu & İnternet Kurulum': 'satellite_internet_setup',
  Marangoz: 'carpenter',
  Boyacı: 'painter',
  Çilingir: 'other',
  'Halı & Koltuk Yıkama': 'other',
  'Temizlik Hizmeti': 'other',

  // Hayvan
  'Veteriner Kliniği': 'veterinarian',
  'Pet Kuaförü': 'pet_groomer',
  'Köpek Eğitmeni': 'pet_trainer',
  'Pet Otel & Pansiyon': 'pet_hotel',
  'Pet Aşı & Sağlık Takibi': 'pet_vaccine_tracking',
  'Pet Bakım & Günlük İzleme': 'pet_groomer',

  // Yeme içme
  Restoran: 'restaurant',
  'Cafe & Kahve': 'restaurant',
  'Pastane & Fırın': 'restaurant',
  'Catering & Davet Yemeği': 'restaurant',
  'Fast Food': 'restaurant',

  // Turizm
  'Tekne Turu': 'boat_tour',
  'Dalış Merkezi': 'diving_center',
  'Araç Kiralama': 'rent_a_car',
  'Profesyonel Fotoğrafçı': 'photographer',
  'Düğün & Etkinlik Organizasyonu': 'wedding_organization',
  'Konaklama & Pansiyon': 'other',

  'Diğer İşletme': 'other',
};

module.exports = {
  AREAS,
  PROFESSIONS_BY_AREA,
  PROFESSION_TO_BUSINESS_TYPE,
};
