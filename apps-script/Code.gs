/**
 * v5.9 changes (2026-10-27): exam solutions (soln / solution / answer
 * key) are no longer converted to PDF for the reMarkable; the original
 * stays in the course's Exams folder. rebuildRemarkable re-classifies
 * files that an older version parked in "Unsorted - Review", so files
 * moved by hand into the folder the current rules pick get their
 * reMarkable copies. Upgrade: paste, Save, run rebuildRemarkable.
 *
 * v5.8 changes (2026-10-25): 203 Finance (lecture-pages, slidesPattern
 * /_lect\d+/i) and 206 Marketing (mirror, Lectures -> Lecture Slides,
 * excludes 263/268/269 leftovers) filled in from term-setup.
 *
 * v5.5 changes (2026-10-19): Fall A (200S, 201A, 202, 205) removed from
 * COURSES after finals, so the hourly run stops checking those four
 * bCourses sites. Their Drive folders now sit in 01 Classes > Fall A 2026
 * (same IDs). STATE_FOLDER_ID still points at the 200S folder on purpose:
 * the state file lives there and moving the folder didn't change its ID.
 *
 *  v5.4 changes (2026-10-13): new file DigestQueue.gs. Once a night (9 PM
 * hour) hourlyRun also writes _Planning/_digest_queue.json: for each
 * current course (read from the Course Index), the notes in _Notes and
 * Discussions that aren't in that course's Concept Log ledger yet. The
 * Sunday review and Thursday digest read this small file instead of
 * opening every Concept Log, which saves tokens. Ledger = source of
 * truth; the JSON is a generated view, safe to delete. Upgrade: add
 * DigestQueue.gs as a second script file, paste this Code.gs, Save, run
 * previewDigestQueue once and check the log.
 *
 * v5.3 changes (2026-10-11): the reMarkable tree is slimmed down to what
 * the course folders can't give the tablet. Files that are already PDFs
 * (slides, readings, most exams) are no longer copied, so you import them
 * straight from the course folders. The tree keeps only (a) Prep sheets
 * and (b) PDF versions of Word / PowerPoint files from bCourses (the
 * reMarkable can't open .docx or .pptx). Set REMARKABLE_COPY_NATIVE_PDFS
 * back to true to restore the full mirror. One-off previewPruneRemarkable()
 * / pruneRemarkable() moves the now-redundant PDF copies to Drive's Trash.
 * Why: a full second copy of every bCourses PDF broke "one source of
 * truth" and wasn't faster to browse than the course folders.
 *
 * v5.2 changes (2026-10-08): lecture pages are now found through
 * Modules as well as the Pages list. When an instructor turns off the
 * Pages tab in course navigation (Econ 201A, Data & Decisions), the Pages
 * list returns 403 and v5.1 silently found zero lecture pages, so no
 * slides or readings ever synced for those courses. Every lecture page is
 * linked from a module students see, so the sync follows those links. Also: module items are fetched
 * from items_url when Canvas leaves them out of a big module, and a
 * WARNING is logged when a lecture-pages course finds no pages.
 * Lecture-page files are filed by page section: slide decks (file name
 * matches the course's slidesPattern) -> "Lecture Slides"; other files
 * under "Class Session" -> "In Lecture Notes". Pre-Class Materials,
 * Objectives and Additional Resources aren't synced (see
 * LECTURE_PAGE_FOLDERS). Slide folders are "Lecture Slides" in every
 * course (folderRenames for Accounting / Leading People) and in
 * reMarkable. extraSourceFolders (Econ and D&D Exams) are copied to
 * reMarkable every hour, honouring each entry's `exclude`. One-off
 * migrateToLectureSlides() moves already-synced files to this layout.
 *
 * v5.1 changes (2026-10-06): (1) the state file's folder is fixed
 * (STATE_FOLDER_ID), so COURSES can be reordered or trimmed safely;
 * (2) dated Google Doc prep sheets in _Study are exported to PDF into
 * reMarkable/<class>/Prep (the cloud nightly prep task saves Docs);
 * (3) Fall B courses added at the end of COURSES as TODO placeholders,
 * which the script skips until term-setup fills them in.
 *
 * bCourses -> Google Drive sync (v5), running entirely inside Google
 * Apps Script under your berkeley.edu account. No Cloud Console, no
 * GitHub, no local install -- this sidesteps the 2-Step Verification
 * block on Cloud Console because Apps Script never touches Cloud
 * Console at all; it runs as you, using the same in-browser "Allow"
 * consent Google Docs add-ons use.
 *
 * ---- Per-course classification ----
 *
 * Each course in COURSES has a `mode`:
 *
 *  - "mirror": Canvas's own Files-tab folder structure is recreated
 *    as-is in Drive (whatever folder names the instructor already
 *    uses). Use this when a course already organizes its Files tab
 *    into folders (Accounting, Leading People).
 *
 *  - "lecture-pages": for courses with no Files-tab folder structure
 *    (Data & Decisions, Econ). Files linked from the Assignments
 *    section land in a `Homework` folder. Files linked from Canvas
 *    Pages (lecture pages) are split by the page's own section
 *    headings: a "Pre-Class Reading" section lands in `Readings`, an
 *    "In-Class Lecture Slides" section lands in `Lecture Notes`. If a
 *    page has no heading we can match, its files fall back to
 *    filename-based classification instead of a guess.
 *
 * In both modes, anything found but NOT confidently classified goes
 * into an `Unsorted - Review` folder per course instead of a guess.
 * Files are stored in their original format: a Word homework file
 * stays a Word file you can type into.
 *
 * ---- reMarkable folder (v5; slimmed in v5.3) ----
 *
 * Since v5.3 only Prep sheets and PDF conversions of Word / PowerPoint
 * files are kept under
 *   MBA/reMarkable/<class>/<Homework | Lecture Slides | In Lecture Notes | Readings & Cases | Exams | Prep>
 * Files that are already PDFs are imported straight from the course
 * folders (see REMARKABLE_COPY_NATIVE_PDFS).
 * The per-course folders above stay the system of record; the
 * reMarkable tree is a read-only copy this script owns. Rules:
 *
 *  1. Only files this script downloaded from bCourses go in -- never
 *     files you made yourself (anything in a "_" folder such as _Study,
 *     _My Work, _Notes, _Exam Prep, or files you dropped in by hand).
 *     So "Homework" means homework the professor posted, nothing else.
 *     Practice problems go in Homework/Practice Problems; quizzes in Exams.
 *     The one deliberate exception is Prep (rule 4).
 *  2. Everything in the reMarkable tree is a PDF. Word and PowerPoint
 *     files are converted for the reMarkable copy only; the course
 *     folders keep the original, so Word homework stays editable.
 *     Excel/CSV files are left out of reMarkable entirely.
 *  3. The subfolder is chosen from the file's destination folder path
 *     (see REMARKABLE_CATEGORIES). A file whose path matches no
 *     category still syncs into the main course folder -- it's just
 *     not copied to reMarkable.
 *  4. Prep: dated prep sheets the class-prep skill saves to a course's
 *     _Study folder ("YYYY-MM-DD – ..." PDFs) are copied into
 *     reMarkable/<class>/Prep. If a sheet is regenerated with the same
 *     name, the copy is replaced. Never edit the reMarkable copy; fix
 *     the _Study original and the next hourly run updates the copy.
 *
 * ---- Schedule & email (v5) ----
 *
 * One hourly trigger runs hourlyRun(): bCourses sync -> prep copy ->
 * (during the 9 PM Pacific hour) one daily summary email of everything
 * that arrived since the last email. No email on days nothing arrived.
 * Overlapping runs are prevented with a script lock.
 *
 * ---- One-time setup / upgrading to v5 ----
 *
 * 1. Fill in driveFolderId and mode for each course in COURSES below.
 * 2. Project Settings -> Script Properties -> CANVAS_TOKEN = <your
 *    bCourses personal access token>.
 * 3. Project Settings -> General -> Time zone -> America/Los_Angeles.
 * 4. Run `dryRun` (function dropdown -> Run). Check the log: each file
 *    shows its Drive destination and, if it qualifies, its reMarkable
 *    subfolder. Changes nothing.
 * 5. Run `rebuildRemarkable`. It builds the new MBA/reMarkable tree from
 *    files already synced (plus prep sheets). If the log says
 *    "NOT FINISHED", run it again until it says "DONE" (Apps Script
 *    stops any single run at 6 minutes).
 * 6. Run `installTriggers` once. It deletes the old runSync triggers and
 *    creates the single hourly trigger for hourlyRun.
 * 7. Check MBA/reMarkable in Drive, then delete the old top-level
 *    "reMarkable" folder by hand. This script never deletes it.
 */

// ---- Configuration -------------------------------------------------

// One daily summary email of new files, sent during this hour (24h,
// Pacific). Only sent when something new arrived.
const SEND_EMAIL_SUMMARY = true;
const DAILY_EMAIL_HOUR = 21; // 9 PM Pacific
const TIME_ZONE = "America/Los_Angeles";

// v5.2: every course's slide decks end up in a folder with this name,
// in Drive and in reMarkable.
const SLIDES_FOLDER_NAME = "Lecture Slides";

const COURSES = [
  // v5.5: Fall A (200S, 201A, 202, 205) removed after finals (Oct 19).
  // ---- Fall B (starts Oct 26). Always ADD new terms at the end of this
  // list; remove a term's entries once its finals are done.
  {
    // v5.8: Files and Pages tabs hidden; "Class N" pages sit in the
    // "Weekly Materials" module. Slide decks are "MBA203_LectNN_print.pdf".
    courseId: 1555531,
    name: "MBA 203 - Finance",
    driveFolderId: "1xyShx8_l9QZIvvAz5YUAv1mgdQZljti3",
    mode: "lecture-pages",
    includeExt: ["pdf", "pptx", "docx", "xlsx"],
    excludeKeywords: ["syllabus", "roster"],
    remarkableFolder: "Finance",
    slidesPattern: /_lect\d+/i,
  },
  {
    // v5.7: Files and Pages tabs hidden; "Week N" pages sit in the
    // "Weekly Materials" module. Slides aren't shared, so no slidesPattern.
    courseId: 1557490,
    name: "MBA 205D - Business Communication",
    driveFolderId: "1sdbayKzgt6BCKFwnw1THbvbR5X3dkd5Y",
    mode: "lecture-pages",
    includeExt: ["pdf", "pptx", "docx", "xlsx"],
    excludeKeywords: ["syllabus", "roster"],
    remarkableFolder: "Business Communication",
  },
  {
    // v5.8: Files tab visible with real folders (Lectures, Exercises/ClassN,
    // QSAs...). "263"/"268"/"269" skip leftover files from other courses
    // sitting in the Files root.
    courseId: 1556326,
    name: "MBA 206 - Marketing",
    driveFolderId: "1VTJE10lMJrAjN3RK3hs6-KYdurtY7YbW",
    mode: "mirror",
    includeExt: ["pdf", "pptx", "docx", "xlsx"],
    excludeKeywords: ["syllabus", "roster", "263", "268", "269"],
    remarkableFolder: "Marketing",
    folderRenames: { lectures: SLIDES_FOLDER_NAME },
  },
];

// Where the small sync-state JSON file lives. v5.1: a fixed folder ID
// (the Data and Decisions course folder, where it has always been), so
// adding, removing or reordering COURSES can never "lose" the state.
const STATE_FOLDER_ID = "1PfgvpL42ilvaqXNATq8_Bw4GR_qYkPem";
function stateParentFolderId_() {
  return STATE_FOLDER_ID;
}
const STATE_FILENAME = "_bcourses_sync_state.json";

const UNSORTED_FOLDER_NAME = "Unsorted - Review";

// The reMarkable tree lives at <REMARKABLE_ROOT_FOLDER_ID>/<REMARKABLE_FOLDER_NAME>.
// Root = the top-level "MBA" folder in My Drive.
const REMARKABLE_ROOT_FOLDER_ID = "1pyrnENlT1f4LHlun6c9FC8fmjopSVk90";
const REMARKABLE_FOLDER_NAME = "reMarkable";

// Each course's own study-output folder, found by name inside the
// course folder (so folder IDs live in one place: the course folder).
const STUDY_FOLDER_NAME = "_Study";
// Prep sheets are named "YYYY-MM-DD – <CODE> – <type> – <topic>.pdf".
const PREP_NAME_RE = /^\d{4}-\d{2}-\d{2}\s/;
const PREP_MAX_BYTES = 20 * 1024 * 1024; // skip anything big (e.g. a textbook)
const PREP_STAMP_PREFIX = "prep-source-updated:";

// reMarkable subfolders, checked IN ORDER against the file's
// destination folder path (lowercased, segments joined with " / ").
// First match wins, so "Practice Final" goes to Exams, not elsewhere.
// Whole-word matching, so "example" never counts as "exam".
// `folder` is a path inside reMarkable/<class>. `alsoFilename: true`
// also tests the file's own name (Econ's "Practice Problems 5.pdf"
// sits in a plain Homework folder but still belongs with practice).
const REMARKABLE_CATEGORIES = [
  { folder: ["Exams"], re: /\b(exams?|finals?|midterms?|quiz(zes)?)\b/ },
  { folder: ["Homework", "Practice Problems"], re: /\bpractice problems?\b/, alsoFilename: true },
  { folder: ["Homework"], re: /\b(homework|hw\d*|problem sets?|psets?|assignments?)\b/ },
  { folder: ["Readings & Cases"], re: /\b(readings?|pre-?\s?reads?|pre-?\s?class|cases?|case stud(y|ies)|class materials?)\b/ },
  // v5.2: in-class worksheets/handouts kept apart from the slide decks.
  { folder: ["In Lecture Notes"], re: /\bin lecture (notes|files)\b/ },
  { folder: [SLIDES_FOLDER_NAME], re: /\b(lectures?|slides?|notes)\b/ }, // v5.2: was "Lecture Notes"
];
const PREP_SUBFOLDER = "Prep";

// Never copied to reMarkable (no useful PDF form).
const REMARKABLE_SKIP_EXT = ["xlsx", "xls", "xlsm", "csv"];

// v5.9: exam solutions stay in the course's Exams folder only; the
// tablet gets the blank practice exam to work on. Substring match, so
// "PracticeMidtermSoln" counts. Other categories are unaffected.
const REMARKABLE_EXAM_SKIP_RE = /soln|solution|answer ?key/i;

// v5.3: false = files that are already PDFs stay only in the course
// folders (import them from there); the reMarkable tree holds just Prep
// and PDF conversions of Word / PowerPoint files. true = full mirror (v5.2).
const REMARKABLE_COPY_NATIVE_PDFS = false;

// Apps Script stops a run at 6 minutes; long jobs stop themselves
// before that and pick up where they left off on the next run.
const TIME_BUDGET_MS = 4.5 * 60 * 1000;

// ---- Entry points ----------------------------------------------------

// What the hourly trigger calls. Installed by installTriggers().
function hourlyRun() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) {
    Logger.log("Another run is still going -- skipping this hour.");
    return;
  }
  // Each step runs even if an earlier one fails (e.g. bCourses is down),
  // so prep copies and the daily email still happen. Any error is
  // re-thrown at the end so Apps Script's failure email still reaches you.
  const errors = [];
  try {
    [runSync, mirrorPrepToRemarkable, mirrorExtraSourcesToRemarkable, buildDigestQueueIfDue_, maybeSendDailySummary_].forEach(function (step) {
      try {
        step();
      } catch (e) {
        Logger.log("Step failed: " + e);
        errors.push(String(e));
      }
    });
  } finally {
    lock.releaseLock();
  }
  if (errors.length) throw new Error(errors.join("\n"));
}

function runSync() {
  return sync_(/* dry = */ false);
}

// Reports what WOULD sync (Drive destination + reMarkable subfolder)
// with zero side effects -- no Drive writes, no state changes, no email.
function dryRun() {
  return sync_(/* dry = */ true);
}

// Run once: removes every existing trigger for runSync/hourlyRun (the
// old 6-7 AM and 9-10 PM ones included) and creates one hourly trigger.
function installTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    const fn = t.getHandlerFunction();
    if (fn === "runSync" || fn === "hourlyRun") {
      ScriptApp.deleteTrigger(t);
      Logger.log("Deleted trigger for " + fn);
    }
  });
  ScriptApp.newTrigger("hourlyRun").timeBased().everyHours(1).create();
  Logger.log("Created hourly trigger for hourlyRun.");
}

function sync_(dry) {
  const baseUrl = getProp_("CANVAS_BASE_URL", "https://bcourses.berkeley.edu").replace(/\/$/, "");
  const token = getProp_("CANVAS_TOKEN", null);
  if (!token) {
    throw new Error(
      "CANVAS_TOKEN is not set. Project Settings -> Script Properties -> add CANVAS_TOKEN."
    );
  }

  const state = dry ? {} : loadState_();
  const fileInfo = dry ? {} : (state._files = state._files || {});
  const emailLines = [];
  const summaryLines = [];
  let totalNew = 0;

  COURSES.forEach(function (course) {
    if (course.driveFolderId.indexOf("TODO") === 0) {
      Logger.log("Skipping " + course.name + " -- driveFolderId not filled in yet.");
      return;
    }
    if (!course.mode) {
      Logger.log("Skipping " + course.name + " -- no 'mode' set (expected 'mirror' or 'lecture-pages').");
      return;
    }

    const cid = String(course.courseId);
    const synced = new Set(state[cid] || []);
    Logger.log("=== " + course.name + " (course " + cid + ") ===");

    const destinations = discoverDestinations_(baseUrl, token, course);
    let newCount = 0;

    Object.keys(destinations).forEach(function (fid) {
      if (synced.has(fid)) return;

      const meta = getFileMetadata_(baseUrl, token, fid);
      // Canvas can return real metadata for a file that's still locked
      // (date-locked, or behind a module prerequisite) -- it omits `url`
      // then. Skip it for now; it's picked up once it unlocks.
      if (!meta || !meta.url) return;

      const fname = meta.display_name;
      if (!matchesFilters_(fname, course.includeExt, course.excludeKeywords)) {
        if (!dry) synced.add(fid); // doesn't match what we want -- stop re-checking it
        return;
      }

      const destPath = destPathFor_(destinations[fid], fname, course);
      if (!destPath) return; // v5.2: a page section we don't sync
      // Files keep their original format in the course folders (Word
      // homework stays editable). Only the reMarkable copy is a PDF.
      const uploadName = fname;
      const rmTarget = course.remarkableFolder ? remarkablePlan_(destPath, uploadName) : null;

      newCount++;
      Logger.log(
        (dry ? "  WOULD SYNC: " : "  NEW: ") + destPath.join("/") + "/" + fname +
        (rmTarget ? "   [reMarkable: " + rmTarget.folder.join("/") + "/" + rmTarget.name + "]" :
          fileExt_(fname) === "pdf" && remarkableCategory_(destPath, fname) ? "   [PDF: import from course folder]" : "   [not for reMarkable]")
      );

      if (!dry) {
        const courseRoot = DriveApp.getFolderById(course.driveFolderId);
        const folder = getOrCreateFolderPath_(courseRoot, destPath);

        // Check Drive itself (not just our state) before uploading, so a
        // crash-and-retry never creates duplicates.
        let mainFile;
        const existing = folder.getFilesByName(uploadName);
        if (existing.hasNext()) {
          Logger.log("  (already in Drive, skipping): " + uploadName);
          mainFile = existing.next();
        } else {
          const resp = UrlFetchApp.fetch(meta.url, { muteHttpExceptions: true });
          mainFile = folder.createFile(resp.getBlob().setName(uploadName));
        }

        if (course.remarkableFolder) {
          const copied = copyToRemarkable_(course, mainFile, destPath);
          if (copied) Logger.log("  -> reMarkable/" + course.remarkableFolder + "/" + copied);
        }

        emailLines.push("[" + course.remarkableFolder + "] " + destPath.join("/") + " <- " + uploadName);
        synced.add(fid);
        fileInfo[fid] = { n: uploadName, p: destPath, d: mainFile.getId() };
        // Saved after EVERY upload so a mid-run crash never causes
        // duplicate re-downloads on retry.
        state[cid] = Array.from(synced);
        saveState_(state);
      }
    });

    if (!dry) {
      state[cid] = Array.from(synced);
      saveState_(state); // catches filtered-out (non-matching) files too
    }
    totalNew += newCount;
    summaryLines.push(course.name + ": " + newCount + (dry ? " would sync" : " new file(s)"));
    Logger.log("  -> " + newCount + (dry ? " file(s) would sync." : " new file(s) synced."));
  });

  if (!dry && emailLines.length) queueEmailLines_(emailLines);

  const summary = summaryLines.join("\n") + "\n\nTotal: " + totalNew;
  Logger.log(summary);
  return summary;
}

// ---- Destination classification -----------------------------------
// Returns { fileId: {kind: "mirror"|"fixed", path: [...]} | {kind: "ambiguous"} }

function discoverDestinations_(baseUrl, token, course) {
  if (course.mode === "mirror") return discoverForMirrorCourse_(baseUrl, token, course.courseId, course.folderRenames);
  if (course.mode === "lecture-pages") return discoverForLecturePagesCourse_(baseUrl, token, course.courseId);
  throw new Error("Unknown mode '" + course.mode + "' for " + course.name);
}

// folderId -> path segments (Canvas's own folder names, root "course
// files" segment stripped off).
function getFolderPathMap_(baseUrl, token, courseId) {
  const folders = canvasGet_(baseUrl, token, "/api/v1/courses/" + courseId + "/folders", { per_page: 100 });
  const map = {};
  folders.forEach(function (f) {
    let parts = (f.full_name || "").split("/");
    if (parts.length && /^course files$/i.test(parts[0])) parts = parts.slice(1);
    map[String(f.id)] = parts;
  });
  return map;
}

// v5.2: folderRenames maps a Canvas top-level folder name (lowercase)
// to the Drive name, e.g. Accounting's "Lecture notes" -> "Lecture Slides".
function renameTopFolder_(path, folderRenames) {
  if (!path.length || !folderRenames) return path;
  const to = folderRenames[path[0].toLowerCase()];
  return to ? [to].concat(path.slice(1)) : path;
}

function discoverForMirrorCourse_(baseUrl, token, courseId, folderRenames) {
  const folderMap = getFolderPathMap_(baseUrl, token, courseId);
  const results = {};

  // Primary source: Canvas's own Files folder structure, mirrored as-is.
  canvasGet_(baseUrl, token, "/api/v1/courses/" + courseId + "/files", { per_page: 100 }).forEach(function (f) {
    const fid = String(f.id);
    const path = renameTopFolder_(folderMap[String(f.folder_id)] || [], folderRenames);
    results[fid] = path.length ? { kind: "mirror", path: path } : { kind: "ambiguous" };
  });

  // Safety net: anything only reachable via modules/pages/assignments/
  // announcements/syllabus (not filed into a Files folder at all).
  discoverSecondaryFileIds_(baseUrl, token, courseId).forEach(function (fid) {
    if (!(fid in results)) results[fid] = { kind: "ambiguous" };
  });

  return results;
}

// v5.2: page-linked files are tagged with their page section
// ({kind: "page", section: "pre-class" | "in-class" | null}); the folder
// is picked in destPathFor_ once the file name is known.
function discoverForLecturePagesCourse_(baseUrl, token, courseId) {
  const results = {};
  function claim(fid, entry) {
    if (!(fid in results)) results[fid] = entry; // first source to find a file wins
  }

  // Confident: Assignments section = Homework.
  canvasGet_(baseUrl, token, "/api/v1/courses/" + courseId + "/assignments", { per_page: 100 }).forEach(function (a) {
    extractFileIds_(a.description).forEach(function (fid) {
      claim(fid, { kind: "fixed", path: ["Homework"] });
    });
  });

  // Lecture Pages: split by the page's own section headings.
  // v5.2: slugs come from the Pages list AND Modules (the list is 403
  // when the Pages tab is turned off in course navigation).
  const slugs = pageSlugs_(baseUrl, token, courseId);
  if (!slugs.length) Logger.log("  WARNING: no lecture pages found -- slides and readings can't sync for this course.");
  slugs.forEach(function (slug) {
    const detail = canvasGet_(baseUrl, token, "/api/v1/courses/" + courseId + "/pages/" + slug);
    if (!detail[0]) return;
    // A sub-heading we don't recognise ("Watch", "In-Class Materials")
    // stays in the section above it; "Objectives" / "Additional
    // Resources (Optional)" end it.
    let current = null;
    splitPageIntoSections_(detail[0].body).forEach(function (section) {
      const s = classifyPageSection_(section.headingText);
      if (s !== undefined) current = s;
      extractFileIds_(section.html).forEach(function (fid) {
        claim(fid, { kind: "page", section: current });
      });
    });
  });

  // Everything else is classified by filename once metadata is fetched.
  canvasGet_(baseUrl, token, "/api/v1/courses/" + courseId + "/files", { per_page: 100 }).forEach(function (f) {
    claim(String(f.id), { kind: "ambiguous" });
  });
  discoverModulesAnnouncementsSyllabusIds_(baseUrl, token, courseId).forEach(function (fid) {
    claim(fid, { kind: "ambiguous" });
  });

  return results;
}

// v5.8: exam materials (practice finals/midterms, cheat sheets, past
// finals like "Final2022") are checked first, so a "...solutions" file
// stays with its practice exam instead of landing in Homework.
function classifyStrayPath_(filename) {
  const lower = (filename || "").toLowerCase();
  const examKw = ["exam", "midterm", "practice", "cheatsheet", "cheat sheet"];
  const homeworkKw = ["homework", "hw", "problem set", "pset", "assignment", "solution", "submission"];
  const readingKw = ["reading", "pre-class", "preclass", "pre class", "case"];
  const lectureKw = ["lecture", "slide", "notes"];
  if (examKw.some(function (kw) { return lower.indexOf(kw) !== -1; }) || /final\s?\d{4}/.test(lower)) return ["Exams"];
  if (homeworkKw.some(function (kw) { return lower.indexOf(kw) !== -1; })) return ["Homework"];
  if (readingKw.some(function (kw) { return lower.indexOf(kw) !== -1; })) return ["Readings"];
  if (lectureKw.some(function (kw) { return lower.indexOf(kw) !== -1; })) return [SLIDES_FOLDER_NAME]; // v5.2: was "Lecture Notes"
  return [UNSORTED_FOLDER_NAME];
}

// Splits a Canvas Page's HTML into chunks at each <h1>-<h4>, pairing
// each chunk with the heading text before it. Regex-based (Apps Script
// has no DOMParser); degrades to "ambiguous" when a page has no headings.
const HEADING_RE = /<h[1-4][^>]*>([\s\S]*?)<\/h[1-4]>/gi;

function splitPageIntoSections_(html) {
  const sections = [];
  const body = html || "";
  let lastIndex = 0;
  let lastHeading = "";
  HEADING_RE.lastIndex = 0;
  let m;
  while ((m = HEADING_RE.exec(body)) !== null) {
    sections.push({ headingText: lastHeading, html: body.substring(lastIndex, m.index) });
    lastHeading = stripTags_(m[1]);
    lastIndex = HEADING_RE.lastIndex;
  }
  sections.push({ headingText: lastHeading, html: body.substring(lastIndex) });
  return sections;
}

function stripTags_(html) {
  return (html || "").replace(/<[^>]+>/g, "").trim();
}

// v5.2: "pre-class" | "in-class" | null (a section we don't sync) |
// undefined (unrecognised sub-heading: keep the section above it).
function classifyPageSection_(headingText) {
  const lower = (headingText || "").toLowerCase();
  if (!lower) return undefined;
  if (/additional|optional|objective/.test(lower)) return null;
  if (/pre-?\s?class|reading/.test(lower)) return "pre-class";
  if (/class session|in-?\s?class|lecture|slide/.test(lower)) return "in-class";
  return undefined;
}

// v5.2: where a lecture-pages file goes. Folder names live here only.
// A section missing from this map isn't synced.
const LECTURE_PAGE_FOLDERS = {
  slides: SLIDES_FOLDER_NAME,       // slide decks (course.slidesPattern)
  "in-class": "In Lecture Notes",   // everything else under Class Session
  // "pre-class": "Readings",       // Pre-Class Materials -- off for now; uncomment to sync readings
};

// The Drive path for a discovered file, or null = don't sync it (yet).
// Files that return null are NOT marked synced, so a rule change later
// still picks them up.
function destPathFor_(entry, fname, course) {
  if (entry.kind === "ambiguous") return classifyStrayPath_(fname);
  if (entry.kind !== "page") return entry.path;
  if (course.slidesPattern && course.slidesPattern.test(fname)) return [LECTURE_PAGE_FOLDERS.slides];
  if (entry.section && LECTURE_PAGE_FOLDERS[entry.section]) return [LECTURE_PAGE_FOLDERS[entry.section]];
  return null; // Objectives / Additional Resources etc.
}

function getOrCreateFolderPath_(rootFolder, pathSegments) {
  let folder = rootFolder;
  pathSegments.forEach(function (name) {
    const it = folder.getFoldersByName(name);
    folder = it.hasNext() ? it.next() : folder.createFolder(name);
  });
  return folder;
}

// Like getOrCreateFolderPath_, but never creates anything; null if missing.
function findFolderPath_(rootFolder, pathSegments) {
  let folder = rootFolder;
  for (let i = 0; i < pathSegments.length; i++) {
    const it = folder.getFoldersByName(pathSegments[i]);
    if (!it.hasNext()) return null;
    folder = it.next();
  }
  return folder;
}

// ---- reMarkable folder ----------------------------------------------

// Which reMarkable subfolder (as a path array) a file belongs in, or null.
function remarkableCategory_(pathSegments, filename) {
  const joined = (pathSegments || []).join(" / ").toLowerCase();
  const withName = joined + " / " + (filename || "").toLowerCase().replace(/[_.]/g, " ");
  for (let i = 0; i < REMARKABLE_CATEGORIES.length; i++) {
    const cat = REMARKABLE_CATEGORIES[i];
    if (cat.re.test(cat.alsoFilename ? withName : joined)) return cat.folder;
  }
  return null;
}

function fileExt_(name) {
  const dot = (name || "").lastIndexOf(".");
  return dot === -1 ? "" : name.substring(dot + 1).toLowerCase();
}

// Where a file would land in reMarkable: {folder, name} or null.
function remarkablePlan_(pathSegments, filename) {
  const folder = remarkableCategory_(pathSegments, filename);
  if (!folder) return null;
  if (folder[0] === "Exams" && REMARKABLE_EXAM_SKIP_RE.test(filename || "")) return null; // v5.9
  const ext = fileExt_(filename);
  if (REMARKABLE_SKIP_EXT.indexOf(ext) !== -1) return null;
  if (ext === "pdf" && !REMARKABLE_COPY_NATIVE_PDFS) return null; // v5.3: import from the course folder
  if (ext !== "pdf" && !isOfficeConvertible_(filename)) return null;
  return { folder: folder, name: ext === "pdf" ? filename : filename.replace(/\.[^.]+$/, ".pdf") };
}

function isOfficeConvertible_(filename) {
  return /\.(docx?|pptx?)$/i.test(filename || "");
}

function remarkableClassFolder_(course) {
  const root = DriveApp.getFolderById(REMARKABLE_ROOT_FOLDER_ID);
  return getOrCreateFolderPath_(root, [REMARKABLE_FOLDER_NAME, course.remarkableFolder]);
}

// Copies one Drive file into reMarkable/<class>/<category> as a PDF.
// Returns "<category>/<name>" if a copy was made, else null. Skips if
// a file with that name is already there.
function copyToRemarkable_(course, file, pathSegments) {
  const plan = remarkablePlan_(pathSegments, file.getName());
  if (!plan) return null;
  const target = getOrCreateFolderPath_(remarkableClassFolder_(course), plan.folder);
  if (target.getFilesByName(plan.name).hasNext()) return null;
  writePdfCopy_(file, target, plan.name);
  return plan.folder.join("/") + "/" + plan.name;
}

function writePdfCopy_(file, targetFolder, pdfName) {
  if (fileExt_(file.getName()) === "pdf") {
    file.makeCopy(pdfName, targetFolder);
  } else {
    const pdf = convertOfficeToPdf_(file.getBlob().getBytes(), file.getName()).setName(pdfName);
    targetFolder.createFile(pdf);
  }
}

/**
 * Copies dated prep sheets from each course's _Study folder into
 * reMarkable/<class>/Prep. Runs every hour from hourlyRun(); safe to
 * run by hand. A regenerated sheet (same name, newer than the copy)
 * replaces the old copy (old one goes to Drive's Trash).
 */
function mirrorPrepToRemarkable() {
  const lines = [];
  COURSES.forEach(function (course) {
    if (!course.remarkableFolder || course.driveFolderId.indexOf("TODO") === 0) return;
    const study = findFolderPath_(DriveApp.getFolderById(course.driveFolderId), [STUDY_FOLDER_NAME]);
    if (!study) return;
    let prepFolder = null;

    const files = study.getFiles();
    while (files.hasNext()) {
      const f = files.next();
      const name = f.getName();
      if (!PREP_NAME_RE.test(name)) continue;
      // v5.1: the cloud prep task saves Google Docs; they're exported to
      // PDF for the reMarkable. PDFs saved by hand are copied as before.
      const isDoc = f.getMimeType() === MimeType.GOOGLE_DOCS;
      if (!isDoc && (fileExt_(name) !== "pdf" || f.getSize() > PREP_MAX_BYTES)) continue;
      const pdfName = isDoc ? name.replace(/\.pdf$/i, "") + ".pdf" : name;
      if (!prepFolder) prepFolder = getOrCreateFolderPath_(remarkableClassFolder_(course), [PREP_SUBFOLDER]);

      // Each copy records the original's "last updated" time in its
      // description, so a regenerated original is spotted reliably.
      const srcStamp = String(f.getLastUpdated().getTime());
      const existing = prepFolder.getFilesByName(pdfName);
      let updated = false;
      if (existing.hasNext()) {
        const copy = existing.next();
        if (copy.getDescription() === PREP_STAMP_PREFIX + srcStamp) continue; // up to date
        // Skip a Doc that is still being written (changed in the last 5 min).
        if (isDoc && Date.now() - f.getLastUpdated().getTime() < 5 * 60 * 1000) continue;
        copy.setTrashed(true);
        updated = true;
      } else if (isDoc && Date.now() - f.getLastUpdated().getTime() < 5 * 60 * 1000) {
        continue; // picked up next hour, once the task has finished writing it
      }
      const out = isDoc ? prepFolder.createFile(exportPrepDocAsPdf_(f.getId()).setName(pdfName)) : f.makeCopy(pdfName, prepFolder);
      out.setDescription(PREP_STAMP_PREFIX + srcStamp);
      lines.push("[" + course.remarkableFolder + "] Prep" + (updated ? " (updated)" : "") + " <- " + pdfName);
    }
  });
  lines.forEach(function (l) { Logger.log(l); });
  if (lines.length) queueEmailLines_(lines);
  return lines.length + " prep sheet(s) copied or updated.";
}

// v5.2: copies each course's extraSourceFolders (e.g. Econ Exams, which
// Pat fills by hand from bCourses) into reMarkable/<class>/<path>. Runs
// every hour; files already there (same name) are skipped, and names
// matching the entry's `exclude` are left out.
function mirrorExtraSourcesToRemarkable() {
  const lines = [];
  COURSES.forEach(function (course) {
    if (!course.remarkableFolder) return;
    (course.extraSourceFolders || []).forEach(function (src) {
      const files = DriveApp.getFolderById(src.folderId).getFiles();
      while (files.hasNext()) {
        const f = files.next();
        if (src.exclude && src.exclude.test(f.getName())) continue;
        const done = copyToRemarkable_(course, f, src.path);
        if (done) lines.push("[" + course.remarkableFolder + "] " + done);
      }
    });
  });
  lines.forEach(function (l) { Logger.log(l); });
  if (lines.length) queueEmailLines_(lines);
  return lines.length + " exam file(s) copied to reMarkable.";
}

// v5.1: exports a Google Doc prep sheet as a compact Letter PDF. Works on
// a temporary copy (narrow margins set there), so the original Doc is
// never modified -- otherwise its "last updated" time would change and
// it would be re-exported every hour.
const PREP_MARGIN_PT = 28; // about 10 mm, same as the class-prep PDF recipe

function exportPrepDocAsPdf_(docId) {
  const temp = DriveApp.getFileById(docId).makeCopy("_temp export");
  try {
    const doc = DocumentApp.openById(temp.getId());
    const body = doc.getBody();
    body.setPageWidth(612).setPageHeight(792); // US Letter
    body.setMarginTop(PREP_MARGIN_PT).setMarginBottom(PREP_MARGIN_PT)
      .setMarginLeft(PREP_MARGIN_PT).setMarginRight(PREP_MARGIN_PT);
    doc.saveAndClose();
    return DriveApp.getFileById(temp.getId()).getAs(MimeType.PDF);
  } finally {
    temp.setTrashed(true);
  }
}

/**
 * Builds the reMarkable tree from files ALREADY synced -- use once after
 * upgrading to v5 (or after changing REMARKABLE_CATEGORIES). It also
 * downloads the editable original of any Word file that older versions
 * stored only as a PDF, so Word homework is back in the course folder. Asks
 * bCourses which files exist and where they belong, finds each one in
 * Drive, and copies the qualifying ones. Because the list comes from
 * bCourses, nothing you made yourself can sneak in. Also copies the
 * hand-filled folders (extraSourceFolders) and prep sheets.
 *
 * Stops itself before Apps Script's 6-minute limit. If the log ends
 * with "NOT FINISHED", run it again; already-copied files are skipped.
 */
function rebuildRemarkable() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30 * 1000)) throw new Error("The hourly sync is running right now -- try again in a few minutes.");
  try {
    return rebuildRemarkable_();
  } finally {
    lock.releaseLock();
  }
}

function rebuildRemarkable_() {
  const start = Date.now();
  const baseUrl = getProp_("CANVAS_BASE_URL", "https://bcourses.berkeley.edu").replace(/\/$/, "");
  const token = getProp_("CANVAS_TOKEN", null);
  if (!token) throw new Error("CANVAS_TOKEN is not set.");

  const state = loadState_();
  const fileInfo = (state._files = state._files || {});
  let copied = 0, notFound = 0, restored = 0, outOfTime = false;

  for (let c = 0; c < COURSES.length && !outOfTime; c++) {
    const course = COURSES[c];
    if (!course.remarkableFolder || course.driveFolderId.indexOf("TODO") === 0) continue;
    const cid = String(course.courseId);
    const synced = new Set(state[cid] || []);
    const courseRoot = DriveApp.getFolderById(course.driveFolderId);
    Logger.log("=== " + course.name + " ===");

    const destinations = discoverDestinations_(baseUrl, token, course);
    const fids = Object.keys(destinations).filter(function (fid) { return synced.has(fid); });

    for (let i = 0; i < fids.length; i++) {
      if (Date.now() - start > TIME_BUDGET_MS) { outOfTime = true; break; }
      const fid = fids[i];
      let info = fileInfo[fid];
      if (info && info.skip) continue;

      if (!info) {
        const meta = getFileMetadata_(baseUrl, token, fid);
        if (!meta || !meta.display_name) continue;
        const fname = meta.display_name;
        if (!matchesFilters_(fname, course.includeExt, course.excludeKeywords)) {
          fileInfo[fid] = { skip: true };
          continue;
        }
        const destPath = destPathFor_(destinations[fid], fname, course);
        if (!destPath) continue;
        info = { n: fname, p: destPath };
        fileInfo[fid] = info;
      }

      // v5.9: a file an older version parked in "Unsorted - Review" is
      // re-classified with today's rules. If it now has a home, record
      // it; the Drive file is still found by its ID (info.d), so a file
      // already moved there by hand works too.
      if (info.p && info.p[0] === UNSORTED_FOLDER_NAME) {
        const newPath = destPathFor_(destinations[fid], info.n, course);
        if (newPath && newPath[0] !== UNSORTED_FOLDER_NAME) {
          Logger.log("  re-classified: " + info.n + " -> " + newPath.join("/"));
          info.p = newPath;
        }
      }

      let file = info.d ? safeGetFile_(info.d) : null;
      if (!file || file.getName() !== info.n) {
        const folder = findFolderPath_(courseRoot, info.p);
        file = null;
        if (folder) {
          const it = folder.getFilesByName(info.n);
          if (it.hasNext()) {
            file = it.next();
          } else if (/\.docx?$/i.test(info.n)) {
            // Before v5, Word files were stored only as converted PDFs.
            // Fetch the editable Word original into the course folder
            // (the old PDF is left where it is).
            const meta = getFileMetadata_(baseUrl, token, fid);
            if (meta && meta.url) {
              file = folder.createFile(UrlFetchApp.fetch(meta.url, { muteHttpExceptions: true }).getBlob().setName(info.n));
              restored++;
              Logger.log("  restored Word original: " + info.p.join("/") + "/" + info.n);
            }
          }
        }
        if (file) info.d = file.getId();
      }
      if (!remarkablePlan_(info.p, info.n)) continue; // not a reMarkable category / Excel
      if (!file) { notFound++; continue; }

      const done = copyToRemarkable_(course, file, info.p);
      if (done) { copied++; Logger.log("  -> " + done); }
    }
    saveState_(state);

    (course.extraSourceFolders || []).forEach(function (src) {
      if (outOfTime) return;
      const files = DriveApp.getFolderById(src.folderId).getFiles();
      while (files.hasNext()) {
        if (Date.now() - start > TIME_BUDGET_MS) { outOfTime = true; return; }
        const f = files.next();
        if (src.exclude && src.exclude.test(f.getName())) continue;
        const done = copyToRemarkable_(course, f, src.path);
        if (done) { copied++; Logger.log("  -> " + done); }
      }
    });
  }

  if (!outOfTime) mirrorPrepToRemarkable();

  const summary = copied + " file(s) copied, " + restored + " Word original(s) restored, " + notFound + " not found in Drive. " +
    (outOfTime ? "NOT FINISHED -- run rebuildRemarkable again." : "DONE.");
  Logger.log(summary);
  return summary;
}

/**
 * ONE-OFF (v5.2): moves what's already synced into the v5.2 layout.
 *  1. reMarkable/<class>/Lecture Notes -> Lecture Slides (every course).
 *  2. Accounting "Lecture notes" and Leading People "class slides" in
 *     Drive -> renamed "Lecture Slides" (same folder, same files).
 *  3. Econ / D&D "Lecture Notes" (made by this morning's runs): slide
 *     decks -> Lecture Slides, everything else -> In Lecture Notes; their
 *     reMarkable copies move to match.
 * Same files and IDs throughout -- nothing is re-downloaded. Also copies
 * the extraSourceFolders (Econ Exams) to reMarkable.
 * Run previewMigration first: it only writes to the log.
 */
function previewMigration() { return migrate_(true); }
function migrateToLectureSlides() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30 * 1000)) throw new Error("The hourly sync is running right now -- try again in a few minutes.");
  try { return migrate_(false); } finally { lock.releaseLock(); }
}

// Renames parent/<fromName> to <toName>, or merges it into an existing
// <toName> folder (moving its contents, then trashing the empty one).
function mergeFolderInto_(parent, fromName, toName, dry, label) {
  const from = findFolderPath_(parent, [fromName]);
  if (!from) return 0;
  const to = findFolderPath_(parent, [toName]);
  Logger.log((dry ? "  WOULD " : "  ") + (to ? "merge " : "rename ") + label + fromName + " -> " + toName);
  if (dry) return 1;
  if (!to) { from.setName(toName); return 1; }
  const files = from.getFiles();
  while (files.hasNext()) files.next().moveTo(to);
  const subs = from.getFolders();
  while (subs.hasNext()) subs.next().moveTo(to);
  from.setTrashed(true);
  return 1;
}

function migrate_(dry) {
  const OLD = "Lecture Notes";
  const state = loadState_();
  const fileInfo = state._files || {};
  const rmRoot = findFolderPath_(DriveApp.getFolderById(REMARKABLE_ROOT_FOLDER_ID), [REMARKABLE_FOLDER_NAME]);
  let changes = 0;

  COURSES.forEach(function (course) {
    if (course.driveFolderId.indexOf("TODO") === 0) return;
    const cid = String(course.courseId);
    const courseRoot = DriveApp.getFolderById(course.driveFolderId);
    Logger.log("=== " + course.name + " ===");

    // 1. reMarkable folder rename.
    const rmClass = rmRoot && course.remarkableFolder ? findFolderPath_(rmRoot, [course.remarkableFolder]) : null;
    if (rmClass) changes += mergeFolderInto_(rmClass, OLD, SLIDES_FOLDER_NAME, dry, "reMarkable/" + course.remarkableFolder + "/");

    // 2. Mirror courses: rename the Drive folder and the paths in the state file.
    Object.keys(course.folderRenames || {}).forEach(function (fromLower) {
      const toName = course.folderRenames[fromLower];
      const it = courseRoot.getFolders();
      const names = [];
      while (it.hasNext()) names.push(it.next().getName());
      names.forEach(function (n) {
        if (n.toLowerCase() === fromLower && n !== toName) changes += mergeFolderInto_(courseRoot, n, toName, dry, "");
      });
      (state[cid] || []).forEach(function (fid) {
        const info = fileInfo[fid];
        if (info && info.p && info.p.length && info.p[0].toLowerCase() === fromLower) info.p = [toName].concat(info.p.slice(1));
      });
    });

    // 3. Lecture-pages courses: split this morning's "Lecture Notes".
    if (course.mode === "lecture-pages" && course.slidesPattern) {
      (state[cid] || []).forEach(function (fid) {
        const info = fileInfo[fid];
        if (!info || info.skip || !info.p || info.p.join("/") !== OLD) return;
        const isSlides = course.slidesPattern.test(info.n);
        const newPath = [isSlides ? LECTURE_PAGE_FOLDERS.slides : LECTURE_PAGE_FOLDERS["in-class"]];
        Logger.log((dry ? "  WOULD MOVE: " : "  moved: ") + OLD + "/" + info.n + " -> " + newPath[0] + "/");
        changes++;
        if (dry) return;
        const file = info.d ? safeGetFile_(info.d) : null;
        if (file) {
          file.moveTo(getOrCreateFolderPath_(courseRoot, newPath));
          if (!isSlides && rmClass) {
            // Its reMarkable copy sat with the slides; move it to In Lecture Notes.
            const plan = remarkablePlan_([OLD], info.n);
            [OLD, SLIDES_FOLDER_NAME].forEach(function (name) {
              const f = plan ? findFolderPath_(rmClass, [name]) : null;
              if (!f) return;
              const it = f.getFilesByName(plan.name);
              while (it.hasNext()) it.next().setTrashed(true);
            });
            copyToRemarkable_(course, file, newPath);
          }
        }
        info.p = newPath;
      });
      if (!dry) {
        const old = findFolderPath_(courseRoot, [OLD]);
        if (old && !old.getFiles().hasNext() && !old.getFolders().hasNext()) {
          old.setTrashed(true);
          Logger.log("  trashed the empty " + OLD + " folder");
        }
      }
    }
  });

  if (!dry) {
    saveState_(state);
    mirrorExtraSourcesToRemarkable();
  }
  const summary = changes + (dry ? " change(s) would be made." : " change(s) made.");
  Logger.log(summary);
  return summary;
}

/**
 * ONE-OFF (v5.3): moves PDF copies the slimmed tree no longer keeps to
 * Drive's Trash (recoverable for 30 days). Walks reMarkable/<class>/*,
 * skipping Prep, and trashes every PDF that isn't a conversion of a Word /
 * PowerPoint file from bCourses; then trashes subfolders left empty.
 * Run previewPruneRemarkable first: it only writes to the log. Afterwards
 * run rebuildRemarkable until DONE -- it re-creates any conversion that
 * was missing (it never re-copies native PDFs while
 * REMARKABLE_COPY_NATIVE_PDFS is false).
 */
function previewPruneRemarkable() { return pruneRemarkable_(true); }
function pruneRemarkable() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30 * 1000)) throw new Error("The hourly sync is running right now -- try again in a few minutes.");
  try { return pruneRemarkable_(false); } finally { lock.releaseLock(); }
}

function pruneRemarkable_(dry) {
  const start = Date.now();
  const rmRoot = findFolderPath_(DriveApp.getFolderById(REMARKABLE_ROOT_FOLDER_ID), [REMARKABLE_FOLDER_NAME]);
  if (!rmRoot) return "No reMarkable folder found -- nothing to do.";
  const state = loadState_();
  const fileInfo = state._files || {};
  let trashed = 0, kept = 0, outOfTime = false;

  // Names of PDFs that are conversions of Office files (these stay).
  function convertedNames_(course) {
    const names = new Set();
    (state[String(course.courseId)] || []).forEach(function (fid) {
      const info = fileInfo[fid];
      if (info && info.n && isOfficeConvertible_(info.n)) names.add(info.n.replace(/\.[^.]+$/, ".pdf"));
    });
    (course.extraSourceFolders || []).forEach(function (src) {
      const files = DriveApp.getFolderById(src.folderId).getFiles();
      while (files.hasNext()) {
        const n = files.next().getName();
        if (isOfficeConvertible_(n)) names.add(n.replace(/\.[^.]+$/, ".pdf"));
      }
    });
    return names;
  }

  // Returns true if the folder is empty afterwards.
  function walk_(folder, label, keepNames) {
    let empty = true;
    const subs = folder.getFolders();
    while (subs.hasNext()) {
      const sub = subs.next();
      if (walk_(sub, label + "/" + sub.getName(), keepNames)) {
        Logger.log((dry ? "  WOULD TRASH empty folder: " : "  Trashed empty folder: ") + label + "/" + sub.getName());
        if (!dry) sub.setTrashed(true);
      } else {
        empty = false;
      }
    }
    const files = folder.getFiles();
    while (files.hasNext()) {
      if (Date.now() - start > TIME_BUDGET_MS) { outOfTime = true; return false; }
      const f = files.next();
      const name = f.getName();
      if (fileExt_(name) === "pdf" && !keepNames.has(name)) {
        trashed++;
        Logger.log((dry ? "  WOULD TRASH: " : "  Trashed: ") + label + "/" + name);
        if (!dry) f.setTrashed(true);
      } else {
        kept++;
        empty = false;
      }
    }
    return empty && !outOfTime;
  }

  COURSES.forEach(function (course) {
    if (outOfTime || !course.remarkableFolder) return;
    const classFolder = findFolderPath_(rmRoot, [course.remarkableFolder]);
    if (!classFolder) return;
    Logger.log("=== " + course.remarkableFolder + " ===");
    const keep = convertedNames_(course);
    const subs = classFolder.getFolders();
    while (subs.hasNext() && !outOfTime) {
      const sub = subs.next();
      if (sub.getName() === PREP_SUBFOLDER) continue; // Prep is never touched
      const label = course.remarkableFolder + "/" + sub.getName();
      if (walk_(sub, label, keep)) {
        Logger.log((dry ? "  WOULD TRASH empty folder: " : "  Trashed empty folder: ") + label);
        if (!dry) sub.setTrashed(true);
      }
    }
  });

  const summary = (dry ? "Would trash " : "Trashed ") + trashed + " PDF copy(ies); kept " + kept + " file(s). " +
    (outOfTime ? "NOT FINISHED -- run it again." : "DONE.");
  Logger.log(summary);
  return summary;
}

function safeGetFile_(id) {
  try {
    const f = DriveApp.getFileById(id);
    return f.isTrashed() ? null : f;
  } catch (e) {
    return null;
  }
}

// ---- Daily summary email --------------------------------------------
// Each run adds what it did to a queue in the state file; the run that
// lands in the DAILY_EMAIL_HOUR sends one email and clears the queue.

function queueEmailLines_(lines) {
  if (!SEND_EMAIL_SUMMARY) return;
  const state = loadState_();
  state._emailQueue = (state._emailQueue || []).concat(lines).slice(-500);
  saveState_(state);
}

function maybeSendDailySummary_() {
  if (!SEND_EMAIL_SUMMARY) return;
  const now = new Date();
  const hour = Number(Utilities.formatDate(now, TIME_ZONE, "H"));
  const today = Utilities.formatDate(now, TIME_ZONE, "yyyy-MM-dd");
  const props = PropertiesService.getScriptProperties();
  if (hour < DAILY_EMAIL_HOUR || props.getProperty("LAST_SUMMARY_DATE") === today) return;

  const state = loadState_();
  const queue = state._emailQueue || [];
  if (queue.length) {
    MailApp.sendEmail(
      Session.getActiveUser().getEmail(),
      "bCourses sync: " + queue.length + " new item(s) (" + today + ")",
      "New since the last summary:\n\n" + queue.join("\n") +
        "\n\nreMarkable copies are in MBA/" + REMARKABLE_FOLDER_NAME + "."
    );
    state._emailQueue = [];
    saveState_(state);
  }
  props.setProperty("LAST_SUMMARY_DATE", today); // only one check per day, sent or not
}

// ---- Canvas discovery --------------------------------------------------
// Many instructors switch the Files tab off (Canvas returns 403 --
// routine), while the same PDFs are still linked from modules, pages,
// assignments, announcements or the syllabus. This walks all of them.

function canvasGet_(baseUrl, token, path, params) {
  let url = path.indexOf("http") === 0 ? path : baseUrl + path;
  if (params) {
    const qs = Object.keys(params)
      .map(function (k) {
        return encodeURIComponent(k) + "=" + encodeURIComponent(params[k]);
      })
      .join("&");
    url += (url.indexOf("?") === -1 ? "?" : "&") + qs;
  }

  const items = [];
  while (url) {
    const resp = UrlFetchApp.fetch(url, {
      headers: { Authorization: "Bearer " + token },
      muteHttpExceptions: true,
    });
    const code = resp.getResponseCode();
    if (code === 403 || code === 404) return items; // tab turned off or removed -- routine
    if (code >= 400) {
      throw new Error("Canvas error " + code + " on " + url + ": " + resp.getContentText());
    }

    const data = JSON.parse(resp.getContentText());
    Array.prototype.push.apply(items, Array.isArray(data) ? data : [data]);

    url = null;
    const headers = resp.getHeaders();
    const link = headers["Link"] || headers["link"];
    if (link) {
      link.split(",").forEach(function (part) {
        if (part.indexOf('rel="next"') !== -1) {
          const match = part.match(/<([^>]+)>/);
          if (match) url = match[1];
        }
      });
    }
  }
  return items;
}

const FILE_LINK_RE = /\/files\/(\d+)/g;

// File IDs linked from a chunk of HTML. Links under /users/ (files
// students attach to discussion posts etc.) are ignored, so only course
// files the instructor posted are picked up.
function extractFileIds_(html) {
  const ids = new Set();
  if (!html) return ids;
  FILE_LINK_RE.lastIndex = 0;
  let m;
  while ((m = FILE_LINK_RE.exec(html)) !== null) {
    const preceding = html.substring(Math.max(0, m.index - 15), m.index);
    if (preceding.indexOf("/users/") === -1) ids.add(m[1]);
  }
  return ids;
}

function union_(a, b) {
  b.forEach(function (v) {
    a.add(v);
  });
  return a;
}

// Full secondary sweep for mirror courses.
function discoverSecondaryFileIds_(baseUrl, token, courseId) {
  const ids = new Set();

  moduleItems_(baseUrl, token, courseId).forEach(function (item) {
    if (item.type === "File" && item.content_id) ids.add(String(item.content_id));
  });

  pageSlugs_(baseUrl, token, courseId).forEach(function (slug) {
    const detail = canvasGet_(baseUrl, token, "/api/v1/courses/" + courseId + "/pages/" + slug);
    if (detail[0]) union_(ids, extractFileIds_(detail[0].body));
  });

  canvasGet_(baseUrl, token, "/api/v1/courses/" + courseId + "/assignments", {
    per_page: 100,
  }).forEach(function (a) {
    union_(ids, extractFileIds_(a.description));
  });

  union_(ids, discoverModulesAnnouncementsSyllabusIds_(baseUrl, token, courseId));

  return ids;
}

// Lean sweep -- modules, announcements, syllabus -- for lecture-pages
// courses, which already scan pages/assignments separately.
function discoverModulesAnnouncementsSyllabusIds_(baseUrl, token, courseId) {
  const ids = new Set();

  moduleItems_(baseUrl, token, courseId).forEach(function (item) {
    if (item.type === "File" && item.content_id) ids.add(String(item.content_id));
  });

  canvasGet_(baseUrl, token, "/api/v1/announcements", {
    "context_codes[]": "course_" + courseId,
    per_page: 100,
  }).forEach(function (a) {
    union_(ids, extractFileIds_(a.message));
  });

  const course = canvasGet_(baseUrl, token, "/api/v1/courses/" + courseId, {
    "include[]": "syllabus_body",
  });
  if (course[0]) union_(ids, extractFileIds_(course[0].syllabus_body));

  return ids;
}

// v5.2: every item in every module. Canvas leaves `items` out of a
// module that has too many; those are fetched from items_url instead.
function moduleItems_(baseUrl, token, courseId) {
  const items = [];
  canvasGet_(baseUrl, token, "/api/v1/courses/" + courseId + "/modules", {
    per_page: 100,
    "include[]": "items",
  }).forEach(function (mod) {
    if (mod.items) {
      Array.prototype.push.apply(items, mod.items);
    } else if (mod.items_url) {
      Array.prototype.push.apply(items, canvasGet_(baseUrl, token, mod.items_url, { per_page: 100 }));
    }
  });
  return items;
}

// v5.2: page slugs from the Pages list (403 when the Pages tab is turned
// off in navigation) plus every Page linked from a module. Only pages a
// student can reach are read; the API runs with the student's own token.
function pageSlugs_(baseUrl, token, courseId) {
  const slugs = new Set();
  canvasGet_(baseUrl, token, "/api/v1/courses/" + courseId + "/pages", { per_page: 100 }).forEach(function (p) {
    if (p.url) slugs.add(p.url);
  });
  moduleItems_(baseUrl, token, courseId).forEach(function (item) {
    if (item.type === "Page" && item.page_url) slugs.add(item.page_url);
  });
  return Array.from(slugs);
}

function getFileMetadata_(baseUrl, token, fileId) {
  const resp = UrlFetchApp.fetch(baseUrl + "/api/v1/files/" + fileId, {
    headers: { Authorization: "Bearer " + token },
    muteHttpExceptions: true,
  });
  const code = resp.getResponseCode();
  if (code === 403 || code === 404) return null;
  if (code >= 400) throw new Error("Canvas error " + code + " fetching file " + fileId);
  return JSON.parse(resp.getContentText());
}

function matchesFilters_(filename, includeExt, excludeKeywords) {
  const ext = fileExt_(filename);
  if (includeExt && includeExt.indexOf(ext) === -1) return false;
  const lower = filename.toLowerCase();
  return !(excludeKeywords || []).some(function (kw) {
    return lower.indexOf(kw.toLowerCase()) !== -1;
  });
}

// ---- Office -> PDF conversion ----------------------------------------
// Avoids the Advanced Drive Service (enabling it can bounce you into
// Cloud Console). Calls the plain Drive v3 REST API with the script's
// own token: upload the Office file asking Drive to convert it to a
// Google Doc/Slides file, export that as PDF, then trash the temp file.

function convertOfficeToPdf_(bytes, originalFilename) {
  const ext = fileExt_(originalFilename);
  const types = {
    doc: ["application/msword", "application/vnd.google-apps.document"],
    docx: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/vnd.google-apps.document"],
    ppt: ["application/vnd.ms-powerpoint", "application/vnd.google-apps.presentation"],
    pptx: ["application/vnd.openxmlformats-officedocument.presentationml.presentation", "application/vnd.google-apps.presentation"],
  };
  if (!types[ext]) throw new Error("Can't convert ." + ext + " to PDF: " + originalFilename);

  const boundary = "bcourses_sync_boundary";
  const metadata = { name: originalFilename, mimeType: types[ext][1] };
  const bodyString =
    "--" + boundary + "\r\n" +
    "Content-Type: application/json; charset=UTF-8\r\n\r\n" +
    JSON.stringify(metadata) + "\r\n" +
    "--" + boundary + "\r\n" +
    "Content-Type: " + types[ext][0] + "\r\n" +
    "Content-Transfer-Encoding: base64\r\n\r\n" +
    Utilities.base64Encode(bytes) + "\r\n" +
    "--" + boundary + "--";

  const createResp = UrlFetchApp.fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart",
    {
      method: "post",
      contentType: "multipart/related; boundary=" + boundary,
      headers: { Authorization: "Bearer " + ScriptApp.getOAuthToken() },
      payload: Utilities.newBlob(bodyString).getBytes(),
      muteHttpExceptions: true,
    }
  );
  if (createResp.getResponseCode() >= 300) {
    throw new Error("Office-to-Google conversion failed: " + createResp.getContentText());
  }

  const tempId = JSON.parse(createResp.getContentText()).id;
  const temp = DriveApp.getFileById(tempId);
  try {
    return temp.getAs(MimeType.PDF);
  } finally {
    temp.setTrashed(true); // clean up the intermediate Google file either way
  }
}

// ---- State: a small JSON file kept in Drive itself ----------------------
// { "<courseId>": [canvas file ids], "_files": {canvasId: {n, p, d}},
//   "_emailQueue": [lines] }

function loadState_() {
  const file = findStateFile_();
  if (!file) return {};
  try {
    return JSON.parse(file.getBlob().getDataAsString());
  } catch (e) {
    return {};
  }
}

function saveState_(state) {
  const content = JSON.stringify(state);
  const file = findStateFile_();
  if (file) {
    file.setContent(content);
  } else {
    DriveApp.getFolderById(stateParentFolderId_()).createFile(STATE_FILENAME, content, MimeType.PLAIN_TEXT);
  }
}

function findStateFile_() {
  const it = DriveApp.getFolderById(stateParentFolderId_()).getFilesByName(STATE_FILENAME);
  return it.hasNext() ? it.next() : null;
}

// ---- Helpers --------------------------------------------------------

function getProp_(key, fallback) {
  const v = PropertiesService.getScriptProperties().getProperty(key);
  return v === null ? fallback : v;
}

function courseById_(courseId) {
  return COURSES.filter(function (c) { return c.courseId === courseId; })[0];
}