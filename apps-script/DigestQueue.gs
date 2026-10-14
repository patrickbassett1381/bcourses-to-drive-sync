/**
 * Digest queue (v5.4, 2026-10-13)
 *
 * WHAT IT DOES
 * Once a night (the 9 PM Pacific hour, same run as the daily email) it
 * compares each current course's notes with that course's Concept Log
 * ledger ("Sources digested", the last section of the log), and writes
 * the notes that are NOT in the ledger yet to one small JSON file:
 *
 *     MBA › 01 Classes › _Planning › _digest_queue.json
 *
 * WHO READS IT
 *  - "Weekly Class Review (Sundays)" step 2c reads this file instead of
 *    opening every Concept Log.
 *  - "Weekly notes digest (Thursdays)" reads it first and opens only the
 *    logs of courses that have something pending.
 *
 * WHY A SCRIPT
 * "Is this file name / Granola ID in that list?" is pure string matching.
 * A script does it for free; Claude doing it costs tokens every run.
 *
 * ONE SOURCE OF TRUTH
 * The ledger inside each Concept Log stays the record of what's been
 * digested. This JSON is a disposable, generated VIEW of it: rebuilt from
 * scratch every night, never edited by hand, safe to delete (the next run
 * recreates it). If it's missing or older than ~36 hours, the scheduled
 * tasks fall back to their old method.
 *
 * WHAT COUNTS AS A NOTE (same rules as the remarkable-digest skill)
 *  - Google Docs and .txt files in the course's _Notes folder.
 *  - .txt caption files in the course's "Discussions" folder.
 *  - A Doc with a "Granola ID: <id>" line is a Granola note: it's digested
 *    when that ID appears in the ledger. Any other file is digested when
 *    its name (with or without extension) appears in the ledger.
 *  - Annotated reMarkable PDFs are not listed (the digest files those
 *    itself, from the reMarkable Exports inbox).
 * It can't see Panopto recordings or notes still only in Granola; the
 * Thursday digest keeps checking those itself.
 *
 * WHERE THE COURSE LIST COMES FROM
 * The Course Index doc (no second copy of any ID here). For every course
 * heading (Heading 3) it reads these lines, which term-setup writes:
 *    Folder: <id>
 *    Subfolders: _Notes <id> · _Study <id> · ...
 *    Concept Log: "<CODE> – Concept Log" (_Exam Prep) <id>
 *    Final exam: <Weekday> <Mon> <D>, ...
 * A course is "current" until the day after its final exam. A course with
 * no readable final-exam date is treated as current and gets a warning.
 *
 * FUNCTIONS
 *  - buildDigestQueue()   build and save the file now (run by hand to test)
 *  - previewDigestQueue() log what the file WOULD say, change nothing
 *  - buildDigestQueueIfDue_()  called by hourlyRun; runs once a day
 */

const COURSE_INDEX_DOC_ID = "1OXfSkyxLDpmoF-3eTvhxYUzcnB2IVvb144EH4dmTslY";
const PLANNING_FOLDER_ID = "1e3mOhfzoEfr0QA6_s7eKb8sBf9gX0rBF";
const DIGEST_QUEUE_FILENAME = "_digest_queue.json";
const DIGEST_QUEUE_HOUR = 21; // 9 PM Pacific, after the 8:52 PM Granola sorter
const DISCUSSIONS_FOLDER_NAME = "Discussions";
const GRANOLA_ID_RE = /Granola ID:\s*([0-9a-f][0-9a-f-]{7,})/i;
const MONTHS_ = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

// ---- Entry points ------------------------------------------------------

function buildDigestQueue() {
  return buildDigestQueue_(/* dry = */ false);
}

function previewDigestQueue() {
  return buildDigestQueue_(/* dry = */ true);
}

// hourlyRun step: only does work once a day, in the DIGEST_QUEUE_HOUR or later.
function buildDigestQueueIfDue_() {
  const now = new Date();
  const hour = Number(Utilities.formatDate(now, TIME_ZONE, "H"));
  const today = Utilities.formatDate(now, TIME_ZONE, "yyyy-MM-dd");
  const props = PropertiesService.getScriptProperties();
  if (hour < DIGEST_QUEUE_HOUR || props.getProperty("LAST_DIGEST_QUEUE_DATE") === today) return;
  buildDigestQueue_(false);
  props.setProperty("LAST_DIGEST_QUEUE_DATE", today);
}

// ---- Main --------------------------------------------------------------

function buildDigestQueue_(dry) {
  const now = new Date();
  const today = Utilities.formatDate(now, TIME_ZONE, "yyyy-MM-dd");
  const warnings = [];
  const state = loadState_();
  const idCache = state._noteGranolaIds || {}; // fileId -> Granola ID ("" = none)

  const courses = readCoursesFromIndex_(warnings).filter(function (c) {
    if (!c.finalExam) return true; // unknown date: keep, warned in the parser
    return c.finalExam >= today;
  });

  const out = [];
  courses.forEach(function (c) {
    const entry = {
      code: c.code,
      name: c.name,
      finalExam: c.finalExam || null,
      conceptLogId: c.conceptLogId,
      notesFolderId: c.notesFolderId,
      logLastUpdated: null,
      pending: []
    };
    if (!c.conceptLogId || !c.notesFolderId) {
      warnings.push(c.code + ": missing Concept Log or _Notes ID in the Course Index; skipped.");
      out.push(entry);
      return;
    }

    let ledger;
    try {
      ledger = readLedger_(c.conceptLogId);
      entry.logLastUpdated = DriveApp.getFileById(c.conceptLogId).getLastUpdated().toISOString();
    } catch (e) {
      warnings.push(c.code + ": couldn't read the Concept Log (" + e + ").");
      out.push(entry);
      return;
    }
    if (!ledger.found) warnings.push(c.code + ": Concept Log has no \"Sources digested\" section; every note counts as pending.");

    noteFiles_(c, warnings).forEach(function (f) {
      const item = classifyNote_(f, idCache);
      const done = item.granolaId
        ? ledger.text.indexOf(item.granolaId.toLowerCase()) !== -1
        : nameInLedger_(item.name, ledger.text);
      if (!done) entry.pending.push(item);
    });
    entry.pending.sort(function (a, b) { return a.created < b.created ? -1 : 1; });
    out.push(entry);
  });

  const total = out.reduce(function (n, c) { return n + c.pending.length; }, 0);
  const result = {
    _readme: "Generated nightly by the bCourses sync script (DigestQueue.gs). Do not edit: rebuilt from each course's _Notes and Discussions folders vs its Concept Log 'Sources digested' ledger. The ledger is the source of truth. Does not cover Panopto or notes not yet filed from Granola.",
    generatedAt: now.toISOString(),
    generatedAtPacific: Utilities.formatDate(now, TIME_ZONE, "yyyy-MM-dd HH:mm"),
    totalPending: total,
    courses: out,
    warnings: warnings
  };

  const json = JSON.stringify(result, null, 1);
  Logger.log(json);
  if (dry) return result;

  state._noteGranolaIds = idCache;
  saveState_(state);
  const folder = DriveApp.getFolderById(PLANNING_FOLDER_ID);
  const it = folder.getFilesByName(DIGEST_QUEUE_FILENAME);
  if (it.hasNext()) it.next().setContent(json);
  else folder.createFile(DIGEST_QUEUE_FILENAME, json, MimeType.PLAIN_TEXT);
  return result;
}

// ---- Course Index parsing ----------------------------------------------

// Returns [{code, name, folderId, notesFolderId, conceptLogId, finalExam}]
function readCoursesFromIndex_(warnings) {
  const body = DocumentApp.openById(COURSE_INDEX_DOC_ID).getBody();
  const n = body.getNumChildren();
  const courses = [];
  let termYear = null;
  let cur = null;

  for (let i = 0; i < n; i++) {
    const el = body.getChild(i);
    const type = el.getType();
    if (type !== DocumentApp.ElementType.PARAGRAPH && type !== DocumentApp.ElementType.LIST_ITEM) continue;
    const text = el.asText().getText().trim();
    if (!text) continue;
    const heading = type === DocumentApp.ElementType.PARAGRAPH ? el.asParagraph().getHeading() : null;

    if (heading === DocumentApp.ParagraphHeading.HEADING2) {
      cur = null; // a new section (a term, or a rules section) ends the course
      const y = text.match(/\b(20\d\d)\b/);
      termYear = y ? Number(y[1]) : null;
      continue;
    }
    if (heading === DocumentApp.ParagraphHeading.HEADING1) { cur = null; continue; }
    if (heading === DocumentApp.ParagraphHeading.HEADING3) {
      const m = text.match(/^(\d{3}[A-Z]?)\s+(.*)$/);
      cur = m ? { code: m[1], name: m[2].replace(/\s*\(.*\)\s*$/, ""), termYear: termYear } : null;
      if (cur) courses.push(cur);
      continue;
    }
    if (!cur) continue;

    let m;
    if ((m = text.match(/^Folder:\s*([\w-]{20,})/))) cur.folderId = m[1];
    else if (/^Subfolders:/.test(text) && (m = text.match(/_Notes\s+([\w-]{20,})/))) cur.notesFolderId = m[1];
    else if (/^Concept Log:/.test(text) && (m = text.match(/([\w-]{30,})\s*$/))) cur.conceptLogId = m[1];
    else if (/^Final exam:/.test(text)) cur.finalExam = parseExamDate_(text, cur.termYear);
  }

  courses.forEach(function (c) {
    if (c.finalExam === undefined || c.finalExam === null) {
      c.finalExam = null;
      warnings.push(c.code + ": no readable \"Final exam:\" date in the Course Index; treated as current.");
    }
  });
  return courses;
}

// "Final exam: Thu Oct 15, 9–11 AM ..." -> "2026-10-15"
function parseExamDate_(line, year) {
  const m = line.match(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+(\d{1,2})\b/);
  if (!m) return null;
  const y = year || Number(Utilities.formatDate(new Date(), TIME_ZONE, "yyyy"));
  const d = new Date(y, MONTHS_[m[1].toLowerCase()], Number(m[2]), 12);
  return Utilities.formatDate(d, TIME_ZONE, "yyyy-MM-dd");
}

// ---- Concept Log ledger -------------------------------------------------

// Text of the "Sources digested" section (everything after its heading),
// normalized for matching.
function readLedger_(logId) {
  const text = DocumentApp.openById(logId).getBody().getText();
  const i = text.lastIndexOf("Sources digested");
  return { found: i !== -1, text: i === -1 ? "" : norm_(text.slice(i)) };
}

function nameInLedger_(name, ledgerText) {
  if (!ledgerText) return false;
  const full = norm_(name);
  const bare = norm_(name.replace(/\.[a-z0-9]{2,4}$/i, ""));
  return ledgerText.indexOf(full) !== -1 || (bare.length >= 6 && ledgerText.indexOf(bare) !== -1);
}

// Lowercase, one kind of dash, single spaces: titles get retyped with
// en dashes vs hyphens and doubled spaces, which shouldn't break a match.
function norm_(s) {
  return String(s).toLowerCase().replace(/[–—−]/g, "-").replace(/\s+/g, " ").trim();
}

// ---- Note files ---------------------------------------------------------

function noteFiles_(course, warnings) {
  const files = [];
  try {
    const it = DriveApp.getFolderById(course.notesFolderId).getFiles();
    while (it.hasNext()) {
      const f = it.next();
      const mt = f.getMimeType();
      if (mt === MimeType.GOOGLE_DOCS || isTxt_(f)) files.push(f);
    }
  } catch (e) {
    warnings.push(course.code + ": couldn't list _Notes (" + e + ").");
  }
  if (course.folderId) {
    try {
      const dIt = DriveApp.getFolderById(course.folderId).getFoldersByName(DISCUSSIONS_FOLDER_NAME);
      while (dIt.hasNext()) {
        const fIt = dIt.next().getFiles();
        while (fIt.hasNext()) {
          const f = fIt.next();
          if (isTxt_(f)) files.push(f);
        }
      }
    } catch (e) {
      warnings.push(course.code + ": couldn't list Discussions (" + e + ").");
    }
  }
  return files;
}

function isTxt_(f) {
  return f.getMimeType() === MimeType.PLAIN_TEXT || /\.txt$/i.test(f.getName());
}

// Reads a Doc once to find its Granola ID line, then caches the answer
// in the state file (the sorter never changes that line).
function classifyNote_(f, idCache) {
  const id = f.getId();
  const isDoc = f.getMimeType() === MimeType.GOOGLE_DOCS;
  let granolaId = "";
  if (isDoc) {
    if (Object.prototype.hasOwnProperty.call(idCache, id)) {
      granolaId = idCache[id];
    } else {
      try {
        const m = DocumentApp.openById(id).getBody().getText().match(GRANOLA_ID_RE);
        granolaId = m ? m[1] : "";
        idCache[id] = granolaId;
      } catch (e) {
        granolaId = ""; // unreadable: fall back to a name match, retry next night
      }
    }
  }
  return {
    name: f.getName(),
    fileId: id,
    type: granolaId ? "granola" : isDoc ? "typed-doc" : "transcript-txt",
    granolaId: granolaId || null,
    created: Utilities.formatDate(f.getDateCreated(), TIME_ZONE, "yyyy-MM-dd")
  };
}
