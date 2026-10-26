/**
 * STATUS: PARKED, never deployed (Oct 2026). Written and mock-tested Sep 28, 2026, but never
 * pasted into Apps Script or run; course deadlines are handled by a weekly Claude review instead.
 * Kept here for reference. The ADR / EC numbers below point to design notes kept outside this repo.
 *
 * Course Sync, Part 1: bCourses assignments → "Course Sync – Master" Google Sheet
 * -----------------------------------------------------------------------------
 * Lives inside the existing "bCourses Sync" Apps Script project (ADR-002).
 * Reuses the CANVAS_TOKEN already stored in Script Properties.
 *
 * What it does on each run:
 *   1. Finds your active bCourses courses whose code starts with "MBA" (ADR-010).
 *   2. Pulls every assignment and quiz in those courses, plus your submission status (ADR-005).
 *   3. Upserts them into the Assignments tab, keyed by Canvas assignment ID (ADR-004, ADR-009).
 *   4. Logs every new item and every change to title, points, due date, or status in Changes (EC-5).
 *   5. Writes overdue / removed / date-change / error flags to Flags (EC-1, EC-6, EC-8).
 *
 * Entry point: runAssignmentSync()
 * All helper names start with "cs_" so they can't clash with functions in other files.
 */

var CS = {
  BASE_URL: 'https://bcourses.berkeley.edu',
  TZ: 'America/Los_Angeles',               // EC-3: always convert from UTC to Pacific
  COURSE_PREFIX: 'MBA',                    // ADR-010: course scope
  SHEET_NAME: 'Course Sync – Master',
  SHEET_ID_PROP: 'CS_SHEET_ID',
  TOKEN_PROP: 'CANVAS_TOKEN',
  HEADERS: ['assignment_id', 'course_id', 'course', 'title', 'type', 'points',
            'due_utc', 'due_pt', 'status', 'submitted_at', 'url',
            'first_seen', 'last_seen', 'last_changed', 'calendar_event_id'],
  CHANGE_HEADERS: ['timestamp', 'assignment_id', 'course', 'title', 'field', 'old', 'new'],
  FLAG_HEADERS: ['timestamp', 'assignment_id', 'course', 'title', 'flag', 'detail', 'resolved']
};

// Column positions (0-based) in the Assignments tab
var CSC = {};
CS.HEADERS.forEach(function (h, i) { CSC[h] = i; });

/** MAIN ENTRY POINT: run this. */
function runAssignmentSync() {
  var token = PropertiesService.getScriptProperties().getProperty(CS.TOKEN_PROP);
  if (!token) throw new Error(CS.TOKEN_PROP + ' not found in Script Properties.');

  var ss = cs_getOrCreateSpreadsheet_();
  var now = new Date();

  // 1. Courses in scope
  var courses = cs_fetchAll_(token, '/api/v1/courses?enrollment_state=active&per_page=100')
    .filter(function (c) {
      return c.course_code && c.course_code.toUpperCase().indexOf(CS.COURSE_PREFIX) === 0;
    });

  // 2. Assignments per course
  var fetched = {};          // assignment_id -> record
  var fetchedCourseIds = {}; // courses successfully pulled this run
  var flags = [];
  var openFlagKeys = cs_openFlagKeys_(ss);

  courses.forEach(function (c) {
    try {
      var items = cs_fetchAll_(token, '/api/v1/courses/' + c.id +
        '/assignments?per_page=100&include[]=submission&order_by=due_at');
      fetchedCourseIds[String(c.id)] = true;
      items.forEach(function (a) {
        var rec = cs_toRecord_(a, c, now);
        fetched[rec.assignment_id] = rec;
      });
    } catch (e) {
      cs_addFlag_(flags, openFlagKeys, now, '', { course: cs_shortCourse_(c.course_code), title: '' },
        'course_error', String(e.message || e).slice(0, 300));
    }
  });

  // 3. Merge with what's already in the sheet
  var sh = ss.getSheetByName('Assignments');
  var existing = {};
  if (sh.getLastRow() > 1) {
    sh.getRange(2, 1, sh.getLastRow() - 1, CS.HEADERS.length).getValues().forEach(function (r) {
      if (r[CSC.assignment_id] !== '') existing[String(r[CSC.assignment_id])] = r;
    });
  }

  var changes = [];
  var out = [];

  Object.keys(fetched).forEach(function (id) {
    var f = fetched[id];
    var old = existing[id];
    var row;

    if (!old) {
      row = [f.assignment_id, f.course_id, f.course, f.title, f.type, f.points,
             f.due_utc, f.due_pt, f.status, f.submitted_at, f.url,
             now, now, now, ''];
      changes.push([now, id, f.course, f.title, 'added', '',
                    f.due_utc ? cs_fmtIso_(f.due_utc) : 'no due date']);
    } else {
      row = old.slice();
      var changed = false;
      ['title', 'points', 'due_utc', 'status'].forEach(function (field) {
        var ov = String(old[CSC[field]]);
        var nv = String(f[field]);
        if (ov !== nv) {
          changed = true;
          var isDate = field === 'due_utc';
          changes.push([now, id, f.course, f.title, isDate ? 'due_date' : field,
                        isDate ? cs_fmtIso_(ov) : ov, isDate ? cs_fmtIso_(nv) : nv]);
          if (isDate && ov !== '') {
            cs_addFlag_(flags, openFlagKeys, now, id, f, 'due_date_changed',
                        cs_fmtIso_(ov) + ' → ' + cs_fmtIso_(nv));
          }
        }
      });
      row[CSC.course] = f.course;
      row[CSC.title] = f.title;
      row[CSC.type] = f.type;
      row[CSC.points] = f.points;
      row[CSC.due_utc] = f.due_utc;
      row[CSC.due_pt] = f.due_pt;
      row[CSC.status] = f.status;
      row[CSC.submitted_at] = f.submitted_at;
      row[CSC.url] = f.url;
      row[CSC.last_seen] = now;
      if (changed) row[CSC.last_changed] = now;
    }

    if (f.status === 'overdue') {
      cs_addFlag_(flags, openFlagKeys, now, id, f, 'overdue',
                  'Past due and not submitted (was due ' + cs_fmtIso_(f.due_utc) + ')');
    }
    out.push(row);
  });

  // EC-6: items that disappeared, but only for courses we successfully pulled this run
  Object.keys(existing).forEach(function (id) {
    if (fetched[id]) return;
    var row = existing[id].slice();
    if (fetchedCourseIds[String(row[CSC.course_id])] && row[CSC.status] !== 'removed') {
      changes.push([now, id, row[CSC.course], row[CSC.title], 'status', row[CSC.status], 'removed']);
      cs_addFlag_(flags, openFlagKeys, now, id,
                  { course: row[CSC.course], title: row[CSC.title] },
                  'removed', 'No longer visible in bCourses (deleted or unpublished)');
      row[CSC.status] = 'removed';
      row[CSC.last_changed] = now;
    }
    out.push(row);
  });

  // Sort by due date (undated at the bottom)
  out.sort(function (a, b) {
    var da = a[CSC.due_pt] instanceof Date ? a[CSC.due_pt].getTime() : Infinity;
    var db = b[CSC.due_pt] instanceof Date ? b[CSC.due_pt].getTime() : Infinity;
    return da - db;
  });

  // 4. Write everything back
  cs_writeAssignments_(sh, out);
  cs_appendRows_(ss.getSheetByName('Changes'), changes);
  cs_appendRows_(ss.getSheetByName('Flags'), flags);

  var status = ss.getSheetByName('Status');
  status.getRange('B1:B4').setValues([
    [now],
    [courses.map(function (c) { return cs_shortCourse_(c.course_code); }).join(', ')],
    [Object.keys(fetched).length],
    [changes.length + ' changes, ' + flags.length + ' new flags']
  ]);
  status.getRange('B1').setNumberFormat('ddd mmm d, h:mm am/pm');

  Logger.log('Course Sync done: %s courses, %s items, %s changes, %s new flags. Sheet: %s',
             courses.length, Object.keys(fetched).length, changes.length, flags.length, ss.getUrl());
}

/* ------------------------------ helpers ------------------------------ */

/** Turn one Canvas assignment into a flat record. */
function cs_toRecord_(a, course, now) {
  var sub = a.submission || {};
  var types = a.submission_types || [];
  return {
    assignment_id: String(a.id),
    course_id: String(course.id),
    course: cs_shortCourse_(course.course_code),
    title: a.name || '(untitled)',
    type: (a.is_quiz_assignment || types.indexOf('online_quiz') >= 0) ? 'quiz' : 'assignment',
    points: (a.points_possible === null || a.points_possible === undefined) ? '' : a.points_possible,
    due_utc: a.due_at || '',
    due_pt: a.due_at ? new Date(a.due_at) : '',
    status: cs_status_(a, sub, now),
    submitted_at: sub.submitted_at || '',
    url: a.html_url || ''
  };
}

/**
 * Status rules:
 *   graded   → graded counts as done even if bCourses says "not submitted" (EC-2)
 *   submitted
 *   undated  → no due date (EC-4)
 *   past     → past due, but there's no online submission (in-class, on paper, none), so it's not "overdue"
 *   overdue  → past due, online submission expected, nothing submitted (EC-1)
 *   upcoming
 */
function cs_status_(a, sub, now) {
  if (sub.workflow_state === 'graded' || sub.excused) return 'graded';
  if (sub.submitted_at || sub.workflow_state === 'submitted' || sub.workflow_state === 'pending_review') {
    return 'submitted';
  }
  if (!a.due_at) return 'undated';
  if (new Date(a.due_at).getTime() < now.getTime()) {
    var types = a.submission_types || [];
    var offline = types.length === 0 || types.every(function (t) {
      return t === 'none' || t === 'on_paper' || t === 'not_graded' || t === 'external_tool';
    });
    return offline ? 'past' : 'overdue';
  }
  return 'upcoming';
}

/** "MBA 205-LEC-01A & 02A FA26" → "MBA 205" */
function cs_shortCourse_(code) {
  var m = String(code || '').match(/^(MBA\s*\d+[A-Z]?)/i);
  return m ? m[1].toUpperCase().replace(/\s+/, ' ') : String(code || '');
}

/** GET a Canvas API path and follow pagination (Link: rel="next"). */
function cs_fetchAll_(token, path) {
  var url = CS.BASE_URL + path;
  var all = [];
  var guard = 0;
  while (url && guard++ < 50) {
    var resp = UrlFetchApp.fetch(url, {
      headers: { Authorization: 'Bearer ' + token },
      muteHttpExceptions: true
    });
    var code = resp.getResponseCode();
    if (code === 401) {
      throw new Error('bCourses rejected CANVAS_TOKEN (401). It may have expired. ' +
        'Create a new token in bCourses → Account → Settings → New Access Token, ' +
        'then paste it into Project Settings → Script Properties → CANVAS_TOKEN.');
    }
    if (code !== 200) {
      throw new Error('bCourses API error ' + code + ' on ' + path + ': ' +
                      resp.getContentText().slice(0, 200));
    }
    all = all.concat(JSON.parse(resp.getContentText()));
    url = cs_nextLink_(resp.getHeaders());
  }
  return all;
}

function cs_nextLink_(headers) {
  var link = headers['Link'] || headers['link'] || '';
  var m = String(link).match(/<([^>]+)>;\s*rel="next"/);
  return m ? m[1] : null;
}

/** Open the Master sheet, or create it (with all tabs) on the first run. */
function cs_getOrCreateSpreadsheet_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty(CS.SHEET_ID_PROP);
  if (id) {
    try { return SpreadsheetApp.openById(id); } catch (e) { /* deleted: recreate below */ }
  }
  var ss = SpreadsheetApp.create(CS.SHEET_NAME);
  ss.setSpreadsheetTimeZone(CS.TZ);

  var a = ss.getSheets()[0];
  a.setName('Assignments');
  cs_header_(a, CS.HEADERS);
  // Keep IDs and ISO timestamps as plain text so Sheets doesn't auto-convert them
  a.getRange('A:B').setNumberFormat('@');
  a.getRange('G:G').setNumberFormat('@');
  a.getRange('J:J').setNumberFormat('@');

  cs_header_(ss.insertSheet('Changes'), CS.CHANGE_HEADERS);
  ss.getSheetByName('Changes').getRange('B:B').setNumberFormat('@');
  cs_header_(ss.insertSheet('Flags'), CS.FLAG_HEADERS);
  ss.getSheetByName('Flags').getRange('B:B').setNumberFormat('@');

  var s = ss.insertSheet('Status');
  s.getRange('A1:A4').setValues([['Last synced'], ['Courses in scope'], ['Items synced'], ['Last run']])
    .setFontWeight('bold');

  props.setProperty(CS.SHEET_ID_PROP, ss.getId());
  return ss;
}

function cs_header_(sheet, headers) {
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
  sheet.setFrozenRows(1);
}

function cs_writeAssignments_(sh, rows) {
  var last = sh.getLastRow();
  if (last > 1) sh.getRange(2, 1, last - 1, CS.HEADERS.length).clearContent();
  if (!rows.length) return;
  sh.getRange(2, 1, rows.length, CS.HEADERS.length).setValues(rows);
  sh.getRange(2, CSC.due_pt + 1, rows.length, 1).setNumberFormat('ddd mmm d, h:mm am/pm');
  sh.getRange(2, CSC.first_seen + 1, rows.length, 3).setNumberFormat('yyyy-mm-dd hh:mm');
}

function cs_appendRows_(sheet, rows) {
  if (!rows.length) return;
  sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
  sheet.getRange(sheet.getLastRow() - rows.length + 1, 1, rows.length, 1)
       .setNumberFormat('yyyy-mm-dd hh:mm');
}

/** Keys of unresolved flags, so the same flag isn't written twice. */
function cs_openFlagKeys_(ss) {
  var keys = {};
  var sh = ss.getSheetByName('Flags');
  if (sh.getLastRow() > 1) {
    sh.getRange(2, 1, sh.getLastRow() - 1, CS.FLAG_HEADERS.length).getValues().forEach(function (r) {
      if (!r[6]) keys[r[1] + '|' + r[4] + '|' + r[5]] = true;
    });
  }
  return keys;
}

function cs_addFlag_(flags, openKeys, now, id, rec, type, detail) {
  var key = id + '|' + type + '|' + detail;
  if (openKeys[key]) return;
  openKeys[key] = true;
  flags.push([now, id, rec.course || '', rec.title || '', type, detail, '']);
}

function cs_fmtIso_(iso) {
  if (!iso || iso === 'undefined') return 'none';
  return Utilities.formatDate(new Date(iso), CS.TZ, 'EEE MMM d, h:mm a');
}
