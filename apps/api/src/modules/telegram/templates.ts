// Localized bot copy, all four locales (TECH-SPEC §7: "localized templates for all four locales").
// `@devon/api` has no dependency on `@devon/i18n` (the same reasoning `apps/api/src/schemas.ts`'s own
// header gives for duplicating `LOCALES` there instead of importing it) -- this module is the Telegram
// bot's own small, self-contained message table, never the web app's `t()`.
export type BotLocale = 'uz-Latn' | 'uz-Cyrl' | 'ru' | 'en'

export function isBotLocale(value: string | null | undefined): value is BotLocale {
  return value === 'uz-Latn' || value === 'uz-Cyrl' || value === 'ru' || value === 'en'
}

export const DEFAULT_BOT_LOCALE: BotLocale = 'uz-Latn'

type Params = Record<string, string | number>

function fill(template: string, params?: Params): string {
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (m, key: string) =>
    key in params ? String(params[key]) : m,
  )
}

const STRINGS: Record<BotLocale, Record<string, string>> = {
  'uz-Latn': {
    maintenance: 'Tizim hozir texnik xizmat rejimida. Birozdan so‘ng qaytadan urinib ko‘ring.',
    'link.prompt_needed':
      'Ushbu buyruq faqat hisobingiz ulangandan keyin ishlaydi. Ilovadagi Sozlamalar bo’limidan ulang.',
    'link.success':
      'Xush kelibsiz, {name}! Telegram hisobingiz ulandi. Endi eslatmalarni shu yerda olasiz.',
    'link.expired': 'Ulash kodi eskirgan. Ilovadan yangi kod oling.',
    'link.already_used': 'Bu kod allaqachon ishlatilgan. Ilovadan yangi kod oling.',
    'link.not_found': 'Bunday kod topilmadi. Kodni tekshirib, qaytadan urinib ko’ring.',
    'unlinked.confirm': 'Telegram ulanishi bekor qilindi. Endi bu yerga eslatmalar kelmaydi.',
    'today.header': 'Bugungi eslatmalar:',
    'today.empty': 'Bugun uchun hech qanday eslatma yo’q. Zo’r kun tilaymiz!',
    'mytasks.header': 'Sizga tegishli oxirgi bildirishnomalar:',
    'mytasks.empty': 'Hozircha yangi bildirishnoma yo’q.',
    'events.header': 'Yaqinlashib kelayotgan tadbirlar:',
    'events.empty': 'Hozircha rejalashtirilgan tadbirlar yo’q.',
    'mute.on': 'Bildirishnomalar {minutes} daqiqaga o’chirildi.',
    'mute.off': 'Bildirishnomalar yoqildi.',
    'mute.usage': 'Namuna: /mute 120 (daqiqalarda, 0 -- darhol yoqish)',
    'group.connected':
      '"{department}" bo’limi ushbu guruhga ulandi. Endi bu yerga tadbirlar, so’rovnomalar va e’lonlar keladi.',
    'group.connect_usage':
      'Guruhni ulash uchun: /connect <kod> (kodni bo’lim boshlig’idan so’rang)',
    'group.connect_invalid': 'Kod noto’g’ri yoki eskirgan.',
    'group.connect_already_used': 'Bu kod allaqachon ishlatilgan.',
    help: 'Buyruqlar: /today -- bugungi eslatmalar, /mytasks -- oxirgi bildirishnomalar, /events -- tadbirlar, /mute <daqiqa> -- bildirishnomalarni o’chirish.',
    'button.mark_done': 'Bajarildi deb belgilash',
    'button.snooze_1d': '1 kunga kechiktirish',
    'button.rsvp_yes': 'Ishtirok etaman',
    'button.rsvp_no': 'Ishtirok etmayman',
    'button.rsvp_maybe': 'Balki',
    'button.open': 'Ochish',
    'action.acknowledged': 'Qabul qilindi.',
    'action.snoozed': '1 kunga kechiktirildi.',
    'action.rsvp_recorded': 'Javobingiz qayd etildi: {choice}',
    'security.code':
      'Tasdiqlash kodingiz: {code}\nUshbu kodni hech kimga aytmang -- uni faqat siz kiritishingiz kerak. {minutes} daqiqa amal qiladi.',
    no_bot: 'Telegram bot hali sozlanmagan. Administratorga murojaat qiling.',
    'miniapp.open': 'Ilovani ochish',
    'miniapp.open_inbox': 'Bildirishnomalar',
    'miniapp.open_board': 'Doska',
    'miniapp.open_today': 'Bugun',
    'miniapp.open_events': 'Tadbirlar',
    'miniapp.open_focus': 'Diqqat',
    'miniapp.open_fields': 'Maʼlumotlarim',
    'miniapp.app_intro':
      'WorkPortal ilovasini shu yerda oching: vazifalar, bildirishnomalar, tadbirlar va diqqat vaqti -- hammasi Telegram ichida.',
    'miniapp.not_available':
      'Ilova hali sozlanmagan. Boʻlim boshligʻidan Telegram sozlamalarini tekshirishni soʻrang.',
    'miniapp.focus_done':
      'Diqqat vaqti tugadi: {minutes} daqiqa. Endi qisqa tanaffus qiling.',
    'miniapp.break_done': 'Tanaffus tugadi ({minutes} daqiqa). Ishni davom ettiramizmi?',
  },
  'uz-Cyrl': {
    maintenance: 'Тизим ҳозир техник хизмат режимида. Бироздан сўнг қайтадан уриниб кўринг.',
    'link.prompt_needed':
      'Ушбу буйруқ фақат ҳисобингиз уланганидан кейин ишлайди. Иловадаги Созламалар бўлимидан уланг.',
    'link.success':
      'Хуш келибсиз, {name}! Telegram ҳисобингиз уланди. Энди эслатмаларни шу ерда оласиз.',
    'link.expired': 'Улаш коди эскирган. Иловадан янги код олинг.',
    'link.already_used': 'Бу код аллақачон ишлатилган. Иловадан янги код олинг.',
    'link.not_found': 'Бундай код топилмади. Кодни текшириб, қайтадан уриниб кўринг.',
    'unlinked.confirm': 'Telegram уланиши бекор қилинди. Энди бу ерга эслатмалар келмайди.',
    'today.header': 'Бугунги эслатмалар:',
    'today.empty': 'Бугун учун ҳеч қандай эслатма йўқ. Зўр кун тилаймиз!',
    'mytasks.header': 'Сизга тегишли охирги билдиришномалар:',
    'mytasks.empty': 'Ҳозирча янги билдиришнома йўқ.',
    'events.header': 'Яқинлашиб келаётган тадбирлар:',
    'events.empty': 'Ҳозирча режалаштирилган тадбирлар йўқ.',
    'mute.on': 'Билдиришномалар {minutes} дақиқага ўчирилди.',
    'mute.off': 'Билдиришномалар ёқилди.',
    'mute.usage': 'Намуна: /mute 120 (дақиқаларда, 0 -- дарҳол ёқиш)',
    'group.connected':
      '"{department}" бўлими ушбу гуруҳга уланди. Энди бу ерга тадбирлар, сўровномалар ва эълонлар келади.',
    'group.connect_usage': 'Гуруҳни улаш учун: /connect <код> (кодни бўлим бошлиғидан сўранг)',
    'group.connect_invalid': 'Код нотўғри ёки эскирган.',
    'group.connect_already_used': 'Бу код аллақачон ишлатилган.',
    help: 'Буйруқлар: /today -- бугунги эслатмалар, /mytasks -- охирги билдиришномалар, /events -- тадбирлар, /mute <дақиқа> -- билдиришномаларни ўчириш.',
    'button.mark_done': 'Бажарилди деб белгилаш',
    'button.snooze_1d': '1 кунга кечиктириш',
    'button.rsvp_yes': 'Иштирок этаман',
    'button.rsvp_no': 'Иштирок этмайман',
    'button.rsvp_maybe': 'Балки',
    'button.open': 'Очиш',
    'action.acknowledged': 'Қабул қилинди.',
    'action.snoozed': '1 кунга кечиктирилди.',
    'action.rsvp_recorded': 'Жавобингиз қайд этилди: {choice}',
    'security.code':
      'Тасдиқлаш кодингиз: {code}\nУшбу кодни ҳеч кимга айтманг -- уни фақат сиз киритишингиз керак. {minutes} дақиқа амал қилади.',
    no_bot: 'Telegram бот ҳали созланмаган. Администраторга мурожаат қилинг.',
    'miniapp.open': 'Иловани очиш',
    'miniapp.open_inbox': 'Билдиришномалар',
    'miniapp.open_board': 'Доска',
    'miniapp.open_today': 'Бугун',
    'miniapp.open_events': 'Тадбирлар',
    'miniapp.open_focus': 'Диққат',
    'miniapp.open_fields': 'Маълумотларим',
    'miniapp.app_intro':
      'WorkPortal иловасини шу ерда очинг: вазифалар, билдиришномалар, тадбирлар ва диққат вақти -- ҳаммаси Telegram ичида.',
    'miniapp.not_available':
      'Илова ҳали созланмаган. Бўлим бошлиғидан Telegram созламаларини текширишни сўранг.',
    'miniapp.focus_done': 'Диққат вақти тугади: {minutes} дақиқа. Энди қисқа танаффус қилинг.',
    'miniapp.break_done': 'Танаффус тугади ({minutes} дақиқа). Ишни давом эттирамизми?',
  },
  ru: {
    maintenance: 'Система сейчас находится в режиме техобслуживания. Попробуйте снова чуть позже.',
    'link.prompt_needed':
      'Эта команда доступна только после привязки аккаунта. Привяжите его в Настройках приложения.',
    'link.success':
      'Добро пожаловать, {name}! Ваш Telegram привязан. Теперь напоминания будут приходить сюда.',
    'link.expired': 'Код привязки устарел. Получите новый код в приложении.',
    'link.already_used': 'Этот код уже использован. Получите новый код в приложении.',
    'link.not_found': 'Такой код не найден. Проверьте код и попробуйте снова.',
    'unlinked.confirm': 'Привязка Telegram отменена. Уведомления сюда больше не будут приходить.',
    'today.header': 'Напоминания на сегодня:',
    'today.empty': 'На сегодня напоминаний нет. Хорошего дня!',
    'mytasks.header': 'Ваши последние уведомления:',
    'mytasks.empty': 'Пока новых уведомлений нет.',
    'events.header': 'Ближайшие мероприятия:',
    'events.empty': 'Запланированных мероприятий пока нет.',
    'mute.on': 'Уведомления отключены на {minutes} мин.',
    'mute.off': 'Уведомления включены.',
    'mute.usage': 'Пример: /mute 120 (в минутах, 0 -- включить сразу)',
    'group.connected':
      'Отдел «{department}» подключён к этой группе. Сюда будут приходить мероприятия, опросы и объявления.',
    'group.connect_usage':
      'Чтобы подключить группу: /connect <код> (код можно получить у руководителя отдела)',
    'group.connect_invalid': 'Код неверный или устарел.',
    'group.connect_already_used': 'Этот код уже использован.',
    help: 'Команды: /today -- напоминания на сегодня, /mytasks -- последние уведомления, /events -- мероприятия, /mute <минуты> -- отключить уведомления.',
    'button.mark_done': 'Отметить выполненным',
    'button.snooze_1d': 'Отложить на 1 день',
    'button.rsvp_yes': 'Буду участвовать',
    'button.rsvp_no': 'Не буду участвовать',
    'button.rsvp_maybe': 'Возможно',
    'button.open': 'Открыть',
    'action.acknowledged': 'Принято.',
    'action.snoozed': 'Отложено на 1 день.',
    'action.rsvp_recorded': 'Ваш ответ записан: {choice}',
    'security.code':
      'Код подтверждения: {code}\nНикому не сообщайте этот код -- ввести его должны только вы. Действует {minutes} мин.',
    no_bot: 'Telegram-бот пока не настроен. Обратитесь к администратору.',
    'miniapp.open': 'Открыть приложение',
    'miniapp.open_inbox': 'Уведомления',
    'miniapp.open_board': 'Доска',
    'miniapp.open_today': 'Сегодня',
    'miniapp.open_events': 'Мероприятия',
    'miniapp.open_focus': 'Фокус',
    'miniapp.open_fields': 'Мои данные',
    'miniapp.app_intro':
      'Откройте WorkPortal прямо здесь: задачи, уведомления, мероприятия и фокус-сессии -- всё внутри Telegram.',
    'miniapp.not_available':
      'Приложение ещё не настроено. Попросите руководителя отдела проверить настройки Telegram.',
    'miniapp.focus_done': 'Фокус-сессия завершена: {minutes} мин. Сделайте короткий перерыв.',
    'miniapp.break_done': 'Перерыв окончен ({minutes} мин). Возвращаемся к работе?',
  },
  en: {
    maintenance: 'The system is currently in maintenance mode. Please try again shortly.',
    'link.prompt_needed':
      'This command only works after your account is linked. Link it from Settings in the app.',
    'link.success': 'Welcome, {name}! Your Telegram is linked. Reminders will now arrive here.',
    'link.expired': 'That linking code has expired. Get a new one from the app.',
    'link.already_used': 'That code has already been used. Get a new one from the app.',
    'link.not_found': 'That code was not found. Check it and try again.',
    'unlinked.confirm': 'Telegram is now unlinked. Notifications will no longer arrive here.',
    'today.header': "Today's reminders:",
    'today.empty': 'Nothing due today. Have a great day!',
    'mytasks.header': 'Your latest notifications:',
    'mytasks.empty': 'No new notifications yet.',
    'events.header': 'Upcoming events:',
    'events.empty': 'No events scheduled yet.',
    'mute.on': 'Notifications muted for {minutes} min.',
    'mute.off': 'Notifications are back on.',
    'mute.usage': 'Example: /mute 120 (minutes; 0 to unmute now)',
    'group.connected':
      '"{department}" is now connected to this group. Events, polls and announcements will arrive here.',
    'group.connect_usage':
      'To connect a group: /connect <code> (ask your head of department for a code)',
    'group.connect_invalid': 'That code is invalid or expired.',
    'group.connect_already_used': 'That code has already been used.',
    help: 'Commands: /today - reminders due today, /mytasks - latest notifications, /events - upcoming events, /mute <minutes> - mute notifications.',
    'button.mark_done': 'Mark done',
    'button.snooze_1d': 'Snooze 1 day',
    'button.rsvp_yes': "I'm going",
    'button.rsvp_no': 'Not going',
    'button.rsvp_maybe': 'Maybe',
    'button.open': 'Open',
    'action.acknowledged': 'Got it.',
    'action.snoozed': 'Snoozed for 1 day.',
    'action.rsvp_recorded': 'Your answer was recorded: {choice}',
    'security.code':
      'Your verification code: {code}\nNever share this code -- only you should enter it. Valid for {minutes} min.',
    no_bot: 'The Telegram bot is not configured yet. Contact your administrator.',
    'miniapp.open': 'Open the app',
    'miniapp.open_inbox': 'Notifications',
    'miniapp.open_board': 'Board',
    'miniapp.open_today': 'Today',
    'miniapp.open_events': 'Events',
    'miniapp.open_focus': 'Focus',
    'miniapp.open_fields': 'My details',
    'miniapp.app_intro':
      'Open WorkPortal right here: tasks, notifications, events and focus sessions -- all inside Telegram.',
    'miniapp.not_available':
      'The app is not set up yet. Ask your head of department to check the Telegram settings.',
    'miniapp.focus_done': 'Focus session finished: {minutes} min. Take a short break.',
    'miniapp.break_done': 'Break over ({minutes} min). Back to work?',
  },
}

export function tb(locale: BotLocale, key: keyof (typeof STRINGS)['en'], params?: Params): string {
  const dict = STRINGS[locale] ?? STRINGS[DEFAULT_BOT_LOCALE]
  const template = dict[key] ?? STRINGS[DEFAULT_BOT_LOCALE][key] ?? key
  return fill(template, params)
}
