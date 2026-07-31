/**
 * Dienstplan-Backend — bedient Telegram-Bot UND Webapp.
 * Etappe A: parse (Datei -> Dienste), write (Dienste -> Kalender), ping.
 *
 * WICHTIG: Projekt-Zeitzone auf "Europe/Berlin" stellen (Zahnrad -> Projekteinstellungen).
 *
 * Aufrufe:
 *   Telegram  -> POST .../exec?wht=WEBHOOK_TOKEN
 *   Webapp    -> POST .../exec   (Body: {action, pass, ...}, Content-Type text/plain)
 */

// ===== CONFIG — ausfuellen =====
const CONFIG = {
  TELEGRAM_TOKEN:  'HIER-BOT-TOKEN',
  ANTHROPIC_KEY:   'HIER-ANTHROPIC-KEY',
  WEBHOOK_TOKEN:   'HIER-WEBHOOK-GEHEIMNIS',   // schuetzt den Telegram-Webhook
  APP_PASSPHRASE:  'HIER-APP-PASSPHRASE',      // tippst du einmal in der Webapp ein
  ALLOWED_CHAT_ID: '',                         // leer -> Bot nennt dir beim 1. Schreiben deine ID
  MODEL:           'claude-sonnet-5',
  CALENDAR_ID:     '8sc6q2hithkk23o7roefg5dhao@group.calendar.google.com'
};
// ================================

/**
 * Schicht-Mapping — einzige Wahrheitsquelle, wird auch an die Webapp geliefert.
 *   sh/sm..eh/em : Kalenderzeit,  plusDay -> Ende am Folgetag
 *   colorId      : Google-Farb-ID (null = noch nicht verifiziert)
 *   pay          : Abrechnung laut Stundennachweis (fuer Etappe C)
 *                  brutto = bezahlte Stunden, tag/n25/n40 = Aufteilung
 *                  extra  = separater Block "2h bei 12 Stunden" (NICHT im Kalender)
 *                  verified = am echten Beleg geprueft?
 */
const MAPPING = {
  F4: { summary:'F4 Gernsheim', sh:6,  sm:0, eh:14, em:30, plusDay:false,
        loc:'Birkenstraße 15, 64579 Gernsheim',   colorId:'6',  farbe:'Mango/Mandarine',
        pay:{ pause:30, brutto:8,  tag:8,  n25:0, n40:0, verified:true } },
  S4: { summary:'S4 Gernsheim', sh:14, sm:0, eh:22, em:30, plusDay:false,
        loc:'Birkenstraße 15, 64579 Gernsheim',   colorId:'2',  farbe:'Salbei',
        pay:{ pause:30, brutto:8,  tag:6,  n25:2, n40:0, verified:true } },
  N4: { summary:'N4 Gernsheim', sh:22, sm:0, eh:6,  em:30, plusDay:true,
        loc:'Birkenstraße 15, 64579 Gernsheim',   colorId:null, farbe:'Kobald (offen)',
        pay:{ pause:30, brutto:8,  tag:0,  n25:4, n40:4, verified:false } },
  T4: { summary:'T4 Gernsheim', sh:6,  sm:0, eh:18, em:30, plusDay:false,
        loc:'Birkenstraße 15, 64579 Gernsheim',   colorId:null, farbe:'Radiccio (offen)',
        pay:{ pause:120, brutto:10, tag:10, n25:0, n40:0, verified:true,
              extra:{ label:'2h bei 12 Stunden', von:'19:00', bis:'21:00', brutto:2, tag:1, n25:1, n40:0 } } },
  F8: { summary:'F8 MöBa',      sh:6,  sm:0, eh:14, em:30, plusDay:false,
        loc:'Jungviehweide 23, 69509 Mörlenbach', colorId:'5',  farbe:'Banane',
        pay:{ pause:30, brutto:8,  tag:8,  n25:0, n40:0, verified:true } },
  S8: { summary:'S8 MöBa',      sh:14, sm:0, eh:22, em:30, plusDay:false,
        loc:'Jungviehweide 23, 69509 Mörlenbach', colorId:'10', farbe:'Basilikum',
        pay:{ pause:30, brutto:8,  tag:6,  n25:2, n40:0, verified:true } },
  N8: { summary:'N8 MöBa',      sh:22, sm:0, eh:6,  em:30, plusDay:true,
        loc:'Jungviehweide 23, 69509 Mörlenbach', colorId:'7',  farbe:'Pfau',
        pay:{ pause:30, brutto:8,  tag:0,  n25:4, n40:4, verified:false } },
  T8: { summary:'T8 MöBa',      sh:6,  sm:0, eh:18, em:30, plusDay:false,
        loc:'Jungviehweide 23, 69509 Mörlenbach', colorId:null, farbe:'Kirschblüte (offen)',
        pay:{ pause:120, brutto:10, tag:10, n25:0, n40:0, verified:true,
              extra:{ label:'2h bei 12 Stunden', von:'19:00', bis:'21:00', brutto:2, tag:1, n25:1, n40:0 } } }
};

const COLOR_MAP = {
  '1':CalendarApp.EventColor.PALE_BLUE, '2':CalendarApp.EventColor.PALE_GREEN,
  '3':CalendarApp.EventColor.MAUVE,     '4':CalendarApp.EventColor.PALE_RED,
  '5':CalendarApp.EventColor.YELLOW,    '6':CalendarApp.EventColor.ORANGE,
  '7':CalendarApp.EventColor.CYAN,      '8':CalendarApp.EventColor.GRAY,
  '9':CalendarApp.EventColor.BLUE,      '10':CalendarApp.EventColor.GREEN,
  '11':CalendarApp.EventColor.RED
};

// ================= Einstieg =================

function doGet() {
  return json_({ ok: true, msg: 'Dienstplan-Backend laeuft.' });
}

function doPost(e) {
  // Telegram erkennt man am Query-Parameter wht
  if (e && e.parameter && e.parameter.wht === CONFIG.WEBHOOK_TOKEN) {
    try {
      const update = JSON.parse(e.postData.contents);
      if (update.callback_query) handleCallback_(update.callback_query);
      else if (update.message)   handleMessage_(update.message);
    } catch (err) {
      console.error(err); // schlucken, sonst wiederholt Telegram endlos
    }
    return ContentService.createTextOutput('ok');
  }
  return handleApi_(e);
}

// ================= Webapp-API =================

function handleApi_(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) return json_({ ok:false, error:'Kein Body' });
    const req = JSON.parse(e.postData.contents);

    if (req.pass !== CONFIG.APP_PASSPHRASE) {
      return json_({ ok:false, error:'Passwort stimmt nicht.' });
    }

    switch (req.action) {
      case 'ping':  return json_({ ok:true, kalender: calName_(), mapping: MAPPING });
      case 'parse': return apiParse_(req);
      case 'write': return apiWrite_(req);
      default:      return json_({ ok:false, error:'Unbekannte Aktion: ' + req.action });
    }
  } catch (err) {
    return json_({ ok:false, error:String(err) });
  }
}

function apiParse_(req) {
  if (!req.fileB64) return json_({ ok:false, error:'Keine Datei empfangen.' });
  const isPdf = (req.mediaType === 'application/pdf');
  const res = parseWithClaude_(req.fileB64, {
    type: isPdf ? 'pdf' : 'image',
    mediaType: isPdf ? 'application/pdf' : (req.mediaType || 'image/jpeg')
  });
  if (res.error) return json_({ ok:false, error:res.error });

  // nur Eintraege behalten, die wir kennen
  const list = res.list.filter(function (x) { return x && x.date && MAPPING[x.code]; });
  list.sort(function (a, b) { return a.date < b.date ? -1 : 1; });
  return json_({ ok:true, list:list, mapping: MAPPING });
}

function apiWrite_(req) {
  if (!Array.isArray(req.items) || !req.items.length) {
    return json_({ ok:false, error:'Keine Dienste zum Eintragen.' });
  }
  const events = buildEvents_(req.items);
  if (!events.length) return json_({ ok:false, error:'Keine gueltigen Dienste.' });
  const res = writeEvents_(events);
  return json_({ ok:true, created:res.created, skipped:res.skipped, errors:res.errors });
}

function calName_() {
  const c = CalendarApp.getCalendarById(CONFIG.CALENDAR_ID);
  return c ? c.getName() : '(kein Zugriff)';
}

// ================= Telegram =================

function handleMessage_(msg) {
  const chatId = String(msg.chat.id);

  if (!CONFIG.ALLOWED_CHAT_ID) {
    tg_('sendMessage', { chat_id: chatId,
      text: 'Deine Chat-ID: ' + chatId + '\nTrag sie in CONFIG.ALLOWED_CHAT_ID ein und deploye neu.' });
    return;
  }
  if (chatId !== String(CONFIG.ALLOWED_CHAT_ID)) return;

  const media = extractMedia_(msg);
  if (!media) {
    tg_('sendMessage', { chat_id: chatId, text: 'Schick mir den Dienstplan als PDF oder Screenshot 📄' });
    return;
  }

  tg_('sendMessage', { chat_id: chatId, text: '⏳ Lese Dienstplan …' });

  const b64 = downloadTelegramFileB64_(media.fileId);
  const parsed = parseWithClaude_(b64, media);
  if (parsed.error) { tg_('sendMessage', { chat_id: chatId, text: '❌ ' + parsed.error }); return; }

  const events = buildEvents_(parsed.list);
  if (!events.length) {
    tg_('sendMessage', { chat_id: chatId, text: 'Keine Dienste erkannt. Ist es der richtige Plan?' });
    return;
  }

  const id = Utilities.getUuid().slice(0, 8);
  CacheService.getScriptCache().put(id, JSON.stringify(events), 21600);
  tg_('sendMessage', {
    chat_id: chatId, text: previewText_(events), parse_mode: 'HTML',
    reply_markup: JSON.stringify({ inline_keyboard: [[
      { text: '✅ Eintragen', callback_data: 'ok:' + id },
      { text: '❌ Abbrechen', callback_data: 'no:' + id }
    ]]})
  });
}

function extractMedia_(msg) {
  if (msg.document) {
    const mt = msg.document.mime_type || '';
    const name = msg.document.file_name || '';
    if (mt === 'application/pdf' || /\.pdf$/i.test(name)) {
      return { type:'pdf', fileId:msg.document.file_id, mediaType:'application/pdf' };
    }
    if (mt.indexOf('image/') === 0) {
      return { type:'image', fileId:msg.document.file_id, mediaType:mt };
    }
  }
  if (msg.photo && msg.photo.length) {
    return { type:'image', fileId:msg.photo[msg.photo.length - 1].file_id, mediaType:'image/jpeg' };
  }
  return null;
}

function handleCallback_(cq) {
  const chatId = String(cq.message.chat.id);
  const parts = cq.data.split(':');
  tg_('answerCallbackQuery', { callback_query_id: cq.id });

  if (parts[0] === 'no') {
    editText_(chatId, cq.message.message_id, '❌ Abgebrochen. Nichts eingetragen.');
    return;
  }
  const raw = CacheService.getScriptCache().get(parts[1]);
  if (!raw) {
    editText_(chatId, cq.message.message_id, '⚠️ Vorschau abgelaufen. Schick den Plan nochmal.');
    return;
  }
  const res = writeEvents_(JSON.parse(raw));
  editText_(chatId, cq.message.message_id,
    '✅ Fertig: ' + res.created + ' eingetragen' +
    (res.skipped ? ', ' + res.skipped + ' schon vorhanden' : '') +
    (res.errors  ? '\n⚠️ Fehler: ' + res.errors : ''));
}

function downloadTelegramFileB64_(fileId) {
  const info = JSON.parse(tg_('getFile', { file_id: fileId }));
  const url = 'https://api.telegram.org/file/bot' + CONFIG.TELEGRAM_TOKEN + '/' + info.result.file_path;
  return Utilities.base64Encode(UrlFetchApp.fetch(url).getBlob().getBytes());
}

// ================= Claude =================

function parseWithClaude_(b64, media) {
  const heute = Utilities.formatDate(new Date(), 'Europe/Berlin', 'yyyy-MM-dd');

  const prompt =
    'Du bekommst einen Dienstplan als PDF oder Screenshot. Er kann in ZWEI Layouts vorliegen: ' +
    '(A) BaBella-Tabelle mit einer Spalte pro Tag; (B) M-Connect-Liste mit einer Zeile je Eintrag ' +
    '(z. B. "03. (Mo.) Früh 8 > Winter  06:00 - 14:30"). ' +
    'Pro Tag koennen MEHRERE Zeilen stehen. Beruecksichtige NUR die eigentliche Dienstzeile und ' +
    'IGNORIERE: Information, Wunschfrei (WX), Frei (X), Einarbeitung (EA), Urlaub (U) und ' +
    'Zusatzzeilen wie "2h bei 12 Stunden". ' +
    'Bestimme den Code aus dem Klartext: Früh->F, Spät->S, Nacht->N, Tag->T, gefolgt von der Zahl (4 oder 8). ' +
    'Beispiele: "Früh 8 > Winter"->F8, "Spät 4 > Lechleiter"->S4, "Tag 8 > Winter"->T8. ' +
    'Steht bereits ein Kuerzel da (F8, S4, ...), nimm es direkt. ' +
    'Gib fuer jeden Tag mit Dienst ein Objekt {"date":"YYYY-MM-DD","code":"..."} aus. ' +
    'Erlaubte codes: F4,S4,N4,T4,F8,S8,N8,T8. ' +
    'Monat/Jahr stehen meist im Dokumentkopf. Falls nicht: Heute ist ' + heute + '; bestimme Monat ' +
    'und Jahr eindeutig anhand der Wochentage (z. B. "01. (Sa.)"). ' +
    'Antworte NUR mit einem JSON-Array, ohne Erklaerung, ohne Markdown.';

  const mediaBlock = (media.type === 'pdf')
    ? { type:'document', source:{ type:'base64', media_type:'application/pdf', data:b64 } }
    : { type:'image',    source:{ type:'base64', media_type:media.mediaType,   data:b64 } };

  const resp = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
    method:'post', contentType:'application/json',
    headers:{ 'x-api-key':CONFIG.ANTHROPIC_KEY, 'anthropic-version':'2023-06-01' },
    payload: JSON.stringify({
      model: CONFIG.MODEL, max_tokens: 2000,
      messages: [{ role:'user', content:[ mediaBlock, { type:'text', text:prompt } ] }]
    }),
    muteHttpExceptions: true
  });

  if (resp.getResponseCode() !== 200) {
    return { error:'Claude-API ' + resp.getResponseCode() + ': ' + resp.getContentText().slice(0,300) };
  }
  const data = JSON.parse(resp.getContentText());
  let txt = (data.content && data.content[0] && data.content[0].text) || '';
  txt = txt.replace(/```json/gi, '').replace(/```/g, '').trim();
  try {
    const list = JSON.parse(txt);
    if (!Array.isArray(list)) return { error:'Unerwartete Antwort von Claude.' };
    return { list:list };
  } catch (err) {
    return { error:'Konnte Claude-Antwort nicht lesen: ' + txt.slice(0,200) };
  }
}

// ================= Kalender =================

function buildEvents_(list) {
  const out = [];
  list.forEach(function (item) {
    const m = MAPPING[item.code];
    if (!m || !item.date) return;
    const d = String(item.date).split('-');
    const y = Number(d[0]), mo = Number(d[1]) - 1, day = Number(d[2]);
    if (!y || isNaN(mo) || !day) return;
    const start = new Date(y, mo, day, m.sh, m.sm);
    const end   = new Date(y, mo, day + (m.plusDay ? 1 : 0), m.eh, m.em);
    out.push({ summary:m.summary, startMs:start.getTime(), endMs:end.getTime(),
               loc:m.loc, colorId:m.colorId, date:item.date, code:item.code });
  });
  out.sort(function (a, b) { return a.startMs - b.startMs; });
  return out;
}

function writeEvents_(events) {
  const cal = CalendarApp.getCalendarById(CONFIG.CALENDAR_ID);
  let created = 0, skipped = 0, errors = 0;
  events.forEach(function (ev) {
    try {
      const start = new Date(ev.startMs), end = new Date(ev.endMs);
      const dup = cal.getEvents(start, end).some(function (x) {
        return x.getTitle() === ev.summary && x.getStartTime().getTime() === start.getTime();
      });
      if (dup) { skipped++; return; }
      const nv = cal.createEvent(ev.summary, start, end, { location: ev.loc });
      if (ev.colorId && COLOR_MAP[ev.colorId]) nv.setColor(COLOR_MAP[ev.colorId]);
      created++;
    } catch (err) { errors++; }
  });
  return { created:created, skipped:skipped, errors:errors };
}

function previewText_(events) {
  const wd = ['So','Mo','Di','Mi','Do','Fr','Sa'];
  let t = '<b>Erkannte Dienste (' + events.length + ')</b>\n';
  events.forEach(function (ev) {
    const s = new Date(ev.startMs);
    const hhmm = Utilities.formatDate(s, 'Europe/Berlin', 'HH:mm');
    t += ev.date + ' (' + wd[s.getDay()] + ') · ' + ev.summary + ' · ' + hhmm +
         (ev.colorId ? '' : ' ⚠️Farbe offen') + '\n';
  });
  return t + '\nEintragen?';
}

// ================= Helfer =================

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
                       .setMimeType(ContentService.MimeType.JSON);
}
function tg_(method, params) {
  return UrlFetchApp.fetch('https://api.telegram.org/bot' + CONFIG.TELEGRAM_TOKEN + '/' + method, {
    method:'post', contentType:'application/json',
    payload: JSON.stringify(params), muteHttpExceptions:true
  }).getContentText();
}
function editText_(chatId, messageId, text) {
  tg_('editMessageText', { chat_id:chatId, message_id:messageId, text:text });
}

// ---- einmalig aus dem Editor ausfuehren ----
function setWebhook_() {
  const url = ScriptApp.getService().getUrl() + '?wht=' + CONFIG.WEBHOOK_TOKEN;
  Logger.log(tg_('setWebhook', { url:url, allowed_updates:['message','callback_query'] }));
}
function deleteWebhook_() { Logger.log(tg_('deleteWebhook', {})); }
