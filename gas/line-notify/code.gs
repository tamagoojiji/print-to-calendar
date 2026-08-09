const SETTINGS_SHEET_NAME = '設定';
const TOKEN_CELL = 'B3';
const HOUR_CELL = 'B4';
const DEFAULT_HOUR = 7;
const WEEKDAY_LABELS = ['日', '月', '火', '水', '木', '金', '土'];
const LINE_BROADCAST_URL = 'https://api.line.me/v2/bot/message/broadcast';

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('LINE通知')
    .addItem('初期設定を実行', 'setup')
    .addItem('通知を停止', 'stopNotifications')
    .addToUi();
}

function setup() {
  const ui = SpreadsheetApp.getUi();
  const sheet = ensureSettingsSheet();
  const token = readToken_(sheet);

  if (!token) {
    ui.alert('「設定」シートにチャネルアクセストークンを貼り付けてから、もう一度実行してください');
    return;
  }

  const hour = readHour_(sheet);

  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    ScriptApp.deleteTrigger(trigger);
  });
  const trigger = ScriptApp.newTrigger('sendDailyDigest')
    .timeBased()
    .everyDays(1)
    .atHour(hour)
    .nearMinute(0)
    .create();

  try {
    sendLine_(token, [
      { type: 'text', text: '✅ 設定が完了しました！\n毎朝' + hour + '時ごろに当日の予定をお届けします。' },
      { type: 'text', text: buildDigest_(new Date()) }
    ]);
  } catch (err) {
    try {
      ScriptApp.deleteTrigger(trigger);
    } catch (ignored) {
      // ロールバック失敗でもユーザーへの失敗通知を優先する
    }
    ui.alert('テスト通知の送信に失敗しました（' + err.message + '）。トークンが正しいかご確認ください。\n' +
      'トークンを修正後、もう一度「初期設定を実行」を実行してください');
    return;
  }

  ui.alert('設定完了！LINEにテスト通知を送りました。届いているか確認してください');
}

function stopNotifications() {
  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    ScriptApp.deleteTrigger(trigger);
  });
  SpreadsheetApp.getUi().alert('通知を停止しました。再開するには「初期設定を実行」を実行してください');
}

function sendDailyDigest() {
  const sheet = ensureSettingsSheet();
  const token = readToken_(sheet);
  if (!token) {
    throw new Error('チャネルアクセストークンが未設定です');
  }
  sendLine_(token, [{ type: 'text', text: buildDigest_(new Date()) }]);
}

function ensureSettingsSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const existing = ss.getSheetByName(SETTINGS_SHEET_NAME);
  if (existing) {
    return existing;
  }

  const sheet = ss.insertSheet(SETTINGS_SHEET_NAME);
  sheet.getRange('A1').setValue('カレンダーLINE通知 設定').setFontWeight('bold');
  sheet.getRange('A3').setValue('チャネルアクセストークン');
  sheet.getRange('A4').setValue('通知時刻（0〜23時）');
  sheet.getRange('A6').setValue('⚠️ トークンは他人に教えないでください');

  const hours = [];
  for (let h = 0; h <= 23; h++) {
    hours.push(String(h));
  }
  const rule = SpreadsheetApp.newDataValidation()
    .requireValueInList(hours, true)
    .setAllowInvalid(false)
    .build();
  sheet.getRange(HOUR_CELL).setDataValidation(rule).setValue(DEFAULT_HOUR);

  sheet.setColumnWidth(1, 220);
  sheet.setColumnWidth(2, 420);
  return sheet;
}

function readToken_(sheet) {
  const raw = sheet.getRange(TOKEN_CELL).getValue();
  if (raw === null || raw === undefined) {
    return '';
  }
  return String(raw).trim();
}

function readHour_(sheet) {
  const raw = sheet.getRange(HOUR_CELL).getValue();
  if (raw === null || raw === undefined || String(raw).trim() === '') {
    return DEFAULT_HOUR;
  }
  const hour = Math.floor(Number(raw));
  if (!isFinite(hour) || hour < 0 || hour > 23) {
    return DEFAULT_HOUR;
  }
  return hour;
}

function buildDigest_(date) {
  const tz = Session.getScriptTimeZone();
  const header = '📅 今日の予定（' + Utilities.formatDate(date, tz, 'M/d') +
    '（' + WEEKDAY_LABELS[date.getDay()] + '））';

  const events = CalendarApp.getDefaultCalendar().getEventsForDay(date);
  if (!events || events.length === 0) {
    return header + '\n今日の予定はありません';
  }

  const items = events.map(function (event) {
    const allDay = event.isAllDayEvent();
    const line = allDay
      ? '・終日：' + event.getTitle()
      : '・' + Utilities.formatDate(event.getStartTime(), tz, 'HH:mm') + '〜' +
        Utilities.formatDate(event.getEndTime(), tz, 'HH:mm') + ' ' + event.getTitle();
    return { allDay: allDay, start: event.getStartTime().getTime(), line: line };
  });

  items.sort(function (a, b) {
    if (a.allDay !== b.allDay) {
      return a.allDay ? -1 : 1;
    }
    return a.start - b.start;
  });

  return header + '\n' + items.map(function (item) { return item.line; }).join('\n');
}

function sendLine_(token, messages) {
  const response = UrlFetchApp.fetch(LINE_BROADCAST_URL, {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + token },
    payload: JSON.stringify({ messages: messages }),
    muteHttpExceptions: true
  });

  const code = response.getResponseCode();
  if (code !== 200) {
    throw new Error('LINE APIエラー（HTTP ' + code + '）');
  }
}
