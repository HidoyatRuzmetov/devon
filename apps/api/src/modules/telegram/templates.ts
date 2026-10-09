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
    'command.help': 'Yordam va buyruqlar',
    'command.mute': 'Bildirishnomalarni vaqtincha oʻchirish',
    maintenance: 'Ilova hozir texnik xizmatda. Birozdan soʻng qaytadan urinib koʻring.',
    'link.prompt_needed':
      'Bu buyruq hisobingiz ulangandan keyin ishlaydi. Ilovaning Sozlamalar boʻlimidan ulang.',
    'link.success':
      'Xush kelibsiz, {name}. Telegram hisobingiz ulandi — eslatmalar endi shu yerga keladi.',
    'link.expired': 'Ulash kodi eskirgan. Ilovadan yangi kod oling.',
    'link.already_used': 'Bu kod allaqachon ishlatilgan. Ilovadan yangi kod oling.',
    'link.chat_in_use':
      'Bu Telegram boshqa hisobga ulangan. Avval oʻsha hisobning Sozlamalar → Telegram boʻlimida ulanishni uzing, keyin qayta urinib koʻring.',
    'link.not_found': 'Bunday kod topilmadi. Kodni tekshirib, qaytadan urinib koʻring.',
    'unlinked.confirm': 'Telegram uzildi. Endi bu yerga eslatma kelmaydi.',
    'today.header': 'Bugungi eslatmalar:',
    'today.empty': 'Bugun uchun eslatma yoʻq.',
    'mytasks.header': 'Soʻnggi bildirishnomalaringiz:',
    'mytasks.empty': 'Hozircha yangi bildirishnoma yoʻq.',
    'events.header': 'Yaqin tadbirlar:',
    'events.empty': 'Rejadagi tadbir yoʻq.',
    'events.group_created': 'Yangi tadbir',
    'events.group_updated': 'Tadbir oʻzgardi',
    'events.group_cancelled': 'Tadbir bekor qilindi',
    'events.group_reminder': 'Tadbir eslatmasi',
    'events.group_poll': 'Tadbirda yangi soʻrovnoma',
    'mute.on': 'Bildirishnomalar {minutes} daqiqaga oʻchirildi.',
    'mute.off': 'Bildirishnomalar yoqildi.',
    'mute.usage': 'Namuna: /mute 120 — 120 daqiqaga oʻchiradi. Darhol yoqish uchun: /mute 0',
    'group.connected':
      '«{department}» shu guruhga ulandi. Endi tadbirlar, soʻrovnomalar va eʼlonlar shu yerga keladi.',
    'group.connect_usage':
      'Guruhni ulash uchun: /connect <kod>. Kodni boshqarma boshligʻidan soʻrang.',
    'group.connect_invalid': 'Kod notoʻgʻri yoki eskirgan.',
    'group.connect_already_used': 'Bu kod allaqachon ishlatilgan.',
    help: 'Buyruqlar: /today — bugungi eslatmalar, /mytasks — soʻnggi bildirishnomalar, /events — yaqin tadbirlar, /mute <daqiqa> — bildirishnomalarni oʻchirish.',
    'button.mark_done': 'Bajarildi',
    'button.snooze_1d': '1 kunga kechiktirish',
    'button.rsvp_yes': 'Boraman',
    'button.rsvp_no': 'Bormayman',
    'button.rsvp_maybe': 'Balki',
    'button.open': 'Ochish',
    'button.fill': 'Toʻldirish',
    'action.acknowledged': 'Qabul qilindi.',
    'action.snoozed': '1 kunga kechiktirildi.',
    'action.rsvp_recorded': 'Javobingiz qayd etildi: {choice}',
    'button.rsvp_waitlist': 'Kutish roʻyxatida',
    'action.rsvp_unavailable':
      'Bu tadbirga javob berib boʻlmaydi. Ilovada tafsilotlarni tekshiring.',
    'action.rsvp_full': 'Boʻsh joy qolmagan, kutish roʻyxati ham yopiq.',
    'action.rsvp_deadline':
      'Javob berish muddati tugagan. Kelmasligingizni hali ham belgilashingiz mumkin.',
    'action.rsvp_failed': 'Javob saqlanmadi. Birozdan soʻng qaytadan urinib koʻring.',
    'security.code':
      'Tasdiqlash kodingiz: {code}\nKodni hech kimga aytmang — uni faqat siz kiritasiz. {minutes} daqiqa amal qiladi.',
    no_bot: 'Telegram bot hali sozlanmagan. Administratorga murojaat qiling.',
    'miniapp.open': 'Ilovani ochish',
    'miniapp.open_inbox': 'Bildirishnomalar',
    'miniapp.open_board': 'Doska',
    'miniapp.open_today': 'Bugun',
    'miniapp.open_events': 'Tadbirlar',
    'miniapp.open_focus': 'Diqqat vaqti',
    'miniapp.open_fields': 'Maʼlumotlarim',
    'miniapp.app_intro':
      'WorkPortal ilovasini shu yerda oching: vazifalar, bildirishnomalar, tadbirlar va diqqat vaqti — hammasi Telegram ichida.',
    'miniapp.not_available':
      'Ilova hali sozlanmagan. Boshqarma boshligʻidan Telegram sozlamalarini tekshirishni soʻrang.',
    'miniapp.focus_done': 'Diqqat vaqti tugadi: {minutes} daqiqa. Endi qisqa tanaffus qiling.',
    'miniapp.break_done': 'Tanaffus tugadi ({minutes} daqiqa). Ishni davom ettiramizmi?',
  },
  'uz-Cyrl': {
    'command.help': 'Ёрдам ва буйруқлар',
    'command.mute': 'Билдиришномаларни вақтинча ўчириш',
    maintenance: 'Илова ҳозир техник хизматда. Бироздан сўнг қайтадан уриниб кўринг.',
    'link.prompt_needed':
      'Бу буйруқ ҳисобингиз улангандан кейин ишлайди. Илованинг Созламалар бўлимидан уланг.',
    'link.success':
      'Хуш келибсиз, {name}. Telegram ҳисобингиз уланди — эслатмалар энди шу ерга келади.',
    'link.expired': 'Улаш коди эскирган. Иловадан янги код олинг.',
    'link.already_used': 'Бу код аллақачон ишлатилган. Иловадан янги код олинг.',
    'link.chat_in_use':
      'Бу Telegram бошқа ҳисобга уланган. Аввал ўша ҳисобнинг Созламалар → Telegram бўлимида уланишни узинг, кейин қайта уриниб кўринг.',
    'link.not_found': 'Бундай код топилмади. Кодни текшириб, қайтадан уриниб кўринг.',
    'unlinked.confirm': 'Telegram узилди. Энди бу ерга эслатма келмайди.',
    'today.header': 'Бугунги эслатмалар:',
    'today.empty': 'Бугун учун эслатма йўқ.',
    'mytasks.header': 'Сўнгги билдиришномаларингиз:',
    'mytasks.empty': 'Ҳозирча янги билдиришнома йўқ.',
    'events.header': 'Яқин тадбирлар:',
    'events.empty': 'Режадаги тадбир йўқ.',
    'events.group_created': 'Янги тадбир',
    'events.group_updated': 'Тадбир ўзгарди',
    'events.group_cancelled': 'Тадбир бекор қилинди',
    'events.group_reminder': 'Тадбир эслатмаси',
    'events.group_poll': 'Тадбирда янги сўровнома',
    'mute.on': 'Билдиришномалар {minutes} дақиқага ўчирилди.',
    'mute.off': 'Билдиришномалар ёқилди.',
    'mute.usage': 'Намуна: /mute 120 — 120 дақиқага ўчиради. Дарҳол ёқиш учун: /mute 0',
    'group.connected':
      '«{department}» шу гуруҳга уланди. Энди тадбирлар, сўровномалар ва эълонлар шу ерга келади.',
    'group.connect_usage': 'Гуруҳни улаш учун: /connect <код>. Кодни бошқарма бошлиғидан сўранг.',
    'group.connect_invalid': 'Код нотўғри ёки эскирган.',
    'group.connect_already_used': 'Бу код аллақачон ишлатилган.',
    help: 'Буйруқлар: /today — бугунги эслатмалар, /mytasks — сўнгги билдиришномалар, /events — яқин тадбирлар, /mute <дақиқа> — билдиришномаларни ўчириш.',
    'button.mark_done': 'Бажарилди',
    'button.snooze_1d': '1 кунга кечиктириш',
    'button.rsvp_yes': 'Бораман',
    'button.rsvp_no': 'Бормайман',
    'button.rsvp_maybe': 'Балки',
    'button.open': 'Очиш',
    'button.fill': 'Тўлдириш',
    'action.acknowledged': 'Қабул қилинди.',
    'action.snoozed': '1 кунга кечиктирилди.',
    'action.rsvp_recorded': 'Жавобингиз қайд этилди: {choice}',
    'button.rsvp_waitlist': 'Кутиш рўйхатида',
    'action.rsvp_unavailable': 'Бу тадбирга жавоб бериб бўлмайди. Иловада тафсилотларни текширинг.',
    'action.rsvp_full': 'Бўш жой қолмаган, кутиш рўйхати ҳам ёпиқ.',
    'action.rsvp_deadline':
      'Жавоб бериш муддати тугаган. Келмаслигингизни ҳали ҳам белгилашингиз мумкин.',
    'action.rsvp_failed': 'Жавоб сақланмади. Бироздан сўнг қайтадан уриниб кўринг.',
    'security.code':
      'Тасдиқлаш кодингиз: {code}\nКодни ҳеч кимга айтманг — уни фақат сиз киритасиз. {minutes} дақиқа амал қилади.',
    no_bot: 'Telegram бот ҳали созланмаган. Администраторга мурожаат қилинг.',
    'miniapp.open': 'Иловани очиш',
    'miniapp.open_inbox': 'Билдиришномалар',
    'miniapp.open_board': 'Доска',
    'miniapp.open_today': 'Бугун',
    'miniapp.open_events': 'Тадбирлар',
    'miniapp.open_focus': 'Диққат вақти',
    'miniapp.open_fields': 'Маълумотларим',
    'miniapp.app_intro':
      'WorkPortal иловасини шу ерда очинг: вазифалар, билдиришномалар, тадбирлар ва диққат вақти — ҳаммаси Telegram ичида.',
    'miniapp.not_available':
      'Илова ҳали созланмаган. Бошқарма бошлиғидан Telegram созламаларини текширишни сўранг.',
    'miniapp.focus_done': 'Диққат вақти тугади: {minutes} дақиқа. Энди қисқа танаффус қилинг.',
    'miniapp.break_done': 'Танаффус тугади ({minutes} дақиқа). Ишни давом эттирамизми?',
  },
  ru: {
    'command.help': 'Помощь и команды',
    'command.mute': 'Временно отключить уведомления',
    maintenance: 'Система сейчас находится в режиме техобслуживания. Попробуйте снова чуть позже.',
    'link.prompt_needed':
      'Эта команда доступна только после привязки аккаунта. Привяжите его в Настройках приложения.',
    'link.success':
      'Добро пожаловать, {name}! Ваш Telegram привязан. Теперь напоминания будут приходить сюда.',
    'link.expired': 'Код привязки устарел. Получите новый код в приложении.',
    'link.already_used': 'Этот код уже использован. Получите новый код в приложении.',
    'link.chat_in_use':
      'Этот Telegram подключён к другому аккаунту. Сначала отключите его в разделе Настройки → Telegram того аккаунта, затем повторите попытку.',
    'link.not_found': 'Такой код не найден. Проверьте код и попробуйте снова.',
    'unlinked.confirm': 'Привязка Telegram отменена. Уведомления сюда больше не будут приходить.',
    'today.header': 'Напоминания на сегодня:',
    'today.empty': 'На сегодня напоминаний нет. Хорошего дня!',
    'mytasks.header': 'Ваши последние уведомления:',
    'mytasks.empty': 'Пока новых уведомлений нет.',
    'events.header': 'Ближайшие мероприятия:',
    'events.empty': 'Запланированных мероприятий пока нет.',
    'events.group_created': 'Новое мероприятие',
    'events.group_updated': 'Мероприятие изменено',
    'events.group_cancelled': 'Мероприятие отменено',
    'events.group_reminder': 'Напоминание о мероприятии',
    'events.group_poll': 'Новый опрос в мероприятии',
    'mute.on': 'Уведомления отключены на {minutes} мин.',
    'mute.off': 'Уведомления включены.',
    'mute.usage': 'Пример: /mute 120 (в минутах, 0 — включить сразу)',
    'group.connected':
      'Отдел «{department}» подключён к этой группе. Сюда будут приходить мероприятия, опросы и объявления.',
    'group.connect_usage':
      'Чтобы подключить группу: /connect <код> (код можно получить у руководителя отдела)',
    'group.connect_invalid': 'Код неверный или устарел.',
    'group.connect_already_used': 'Этот код уже использован.',
    help: 'Команды: /today — напоминания на сегодня, /mytasks — последние уведомления, /events — мероприятия, /mute <минуты> — отключить уведомления.',
    'button.mark_done': 'Отметить выполненным',
    'button.snooze_1d': 'Отложить на 1 день',
    'button.rsvp_yes': 'Буду участвовать',
    'button.rsvp_no': 'Не буду участвовать',
    'button.rsvp_maybe': 'Возможно',
    'button.open': 'Открыть',
    'button.fill': 'Заполнить',
    'action.acknowledged': 'Принято.',
    'action.snoozed': 'Отложено на 1 день.',
    'action.rsvp_recorded': 'Ваш ответ записан: {choice}',
    'button.rsvp_waitlist': 'В списке ожидания',
    'action.rsvp_unavailable':
      'Ответить на это мероприятие нельзя. Проверьте подробности в приложении.',
    'action.rsvp_full': 'Свободных мест нет, список ожидания закрыт.',
    'action.rsvp_deadline': 'Срок ответа истёк. Отметить отказ от участия ещё можно.',
    'action.rsvp_failed': 'Ответ не сохранён. Попробуйте снова чуть позже.',
    'security.code':
      'Код подтверждения: {code}\nНикому не сообщайте этот код — ввести его должны только вы. Действует {minutes} мин.',
    no_bot: 'Telegram-бот пока не настроен. Обратитесь к администратору.',
    'miniapp.open': 'Открыть приложение',
    'miniapp.open_inbox': 'Уведомления',
    'miniapp.open_board': 'Доска',
    'miniapp.open_today': 'Сегодня',
    'miniapp.open_events': 'Мероприятия',
    'miniapp.open_focus': 'Фокус',
    'miniapp.open_fields': 'Мои данные',
    'miniapp.app_intro':
      'Откройте WorkPortal прямо здесь: задачи, уведомления, мероприятия и фокус-сессии — всё внутри Telegram.',
    'miniapp.not_available':
      'Приложение ещё не настроено. Попросите руководителя отдела проверить настройки Telegram.',
    'miniapp.focus_done': 'Фокус-сессия завершена: {minutes} мин. Сделайте короткий перерыв.',
    'miniapp.break_done': 'Перерыв окончен ({minutes} мин). Возвращаемся к работе?',
  },
  en: {
    'command.help': 'Help and commands',
    'command.mute': 'Temporarily mute notifications',
    maintenance: 'The system is currently in maintenance mode. Please try again shortly.',
    'link.prompt_needed':
      'This command only works after your account is linked. Link it from Settings in the app.',
    'link.success': 'Welcome, {name}! Your Telegram is linked. Reminders will now arrive here.',
    'link.expired': 'That linking code has expired. Get a new one from the app.',
    'link.already_used': 'That code has already been used. Get a new one from the app.',
    'link.chat_in_use':
      'This Telegram is linked to another account. Open Settings → Telegram in the linked account and disconnect it first, then try again.',
    'link.not_found': 'That code was not found. Check it and try again.',
    'unlinked.confirm': 'Telegram is now unlinked. Notifications will no longer arrive here.',
    'today.header': "Today's reminders:",
    'today.empty': 'Nothing due today. Have a great day!',
    'mytasks.header': 'Your latest notifications:',
    'mytasks.empty': 'No new notifications yet.',
    'events.header': 'Upcoming events:',
    'events.empty': 'No events scheduled yet.',
    'events.group_created': 'New event',
    'events.group_updated': 'Event changed',
    'events.group_cancelled': 'Event cancelled',
    'events.group_reminder': 'Event reminder',
    'events.group_poll': 'New event poll',
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
    'button.fill': 'Fill in',
    'action.acknowledged': 'Got it.',
    'action.snoozed': 'Snoozed for 1 day.',
    'action.rsvp_recorded': 'Your answer was recorded: {choice}',
    'button.rsvp_waitlist': 'On the waitlist',
    'action.rsvp_unavailable': 'You cannot answer this event. Check its details in the app.',
    'action.rsvp_full': 'No spots remain and the waitlist is closed.',
    'action.rsvp_deadline': 'The RSVP deadline has passed. You can still decline.',
    'action.rsvp_failed': 'Your answer was not saved. Please try again shortly.',
    'security.code':
      'Your verification code: {code}\nNever share this code — only you should enter it. Valid for {minutes} min.',
    no_bot: 'The Telegram bot is not configured yet. Contact your administrator.',
    'miniapp.open': 'Open the app',
    'miniapp.open_inbox': 'Notifications',
    'miniapp.open_board': 'Board',
    'miniapp.open_today': 'Today',
    'miniapp.open_events': 'Events',
    'miniapp.open_focus': 'Focus',
    'miniapp.open_fields': 'My details',
    'miniapp.app_intro':
      'Open WorkPortal right here: your work, notifications, events and focus time — all inside Telegram.',
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
