/**
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
 * ---- reMarkable folder (v5) ----
 *
 * A second copy of selected files is kept under
 *   MBA/reMarkable/<class>/<Homework | Lecture Notes | Readings & Cases | Exams | Prep>
 * so importing onto the tablet means opening one tidy folder per class.
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

const COURSES = [
  {
    courseId: 1555528,
    name: "MBA 200S - Data and Decisions",
    driveFolderId: "1PfgvpL42ilvaqXNATq8_Bw4GR_qYkPem",
    mode: "lecture-pages",
    includeExt: ["pdf", "pptx", "docx", "xlsx"],
    excludeKeywords: ["syllabus", "roster"],
    remarkableFolder: "Data and Decisions",
    // Folders filled from bCourses by the one-off scrub functions below
    // (not by runSync). Everything in them came from bCourses, so
    // rebuildRemarkable() includes them.
    extraSourceFolders: [{ folderId: "1OHkZScCA7HqQ3lVgBkCbI0kY9UtwIl9J", path: ["Exams"] }],
  },
  {
    courseId: 1555514,
    name: "MBA 201A - Economics for Business Decision Making",
    driveFolderId: "1VyWcWOHZLlfEpqWtcecDoBYYvEQYbnSe",
    mode: "lecture-pages",
    includeExt: ["pdf", "pptx", "docx", "xlsx"],
    excludeKeywords: ["syllabus", "roster"],
    remarkableFolder: "Economics",
  },
  {
    courseId: 1555594,
    name: "MBA 202 - Financial Accounting",
    driveFolderId: "1_3YlYxTNJck7E9fbNM4i0gtwe4RTFPvL",
    mode: "mirror",
    includeExt: ["pdf", "pptx", "docx", "xlsx"],
    excludeKeywords: ["syllabus", "roster"],
    remarkableFolder: "Financial Accounting",
  },
  {
    courseId: 1555298,
    name: "MBA 205 - Leading People",
    driveFolderId: "1JrTl0EZHo04iq0FU-9OCd6iiHP9sYs43",
    mode: "mirror",
    includeExt: ["pdf", "pptx", "docx", "xlsx"],
    excludeKeywords: ["syllabus", "roster"],
    remarkableFolder: "Leading People",
  },
];

// Where the small sync-state JSON file lives (first course's folder).
function stateParentFolderId_() {
  return COURSES[0].driveFolderId;
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
  { folder: ["Lecture Notes"], re: /\b(lectures?|slides?|notes)\b/ },
];
const PREP_SUBFOLDER = "Prep";

// Never copied to reMarkable (no useful PDF form).
const REMARKABLE_SKIP_EXT = ["xlsx", "xls", "xlsm", "csv"];

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
    [runSync, mirrorPrepToRemarkable, maybeSendDailySummary_].forEach(function (step) {
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

      const entry = destinations[fid];
      const destPath = entry.kind === "ambiguous" ? classifyStrayPath_(fname) : entry.path;
      // Files keep their original format in the course folders (Word
      // homework stays editable). Only the reMarkable copy is a PDF.
      const uploadName = fname;
      const rmTarget = course.remarkableFolder ? remarkablePlan_(destPath, uploadName) : null;

      newCount++;
      Logger.log(
        (dry ? "  WOULD SYNC: " : "  NEW: ") + destPath.join("/") + "/" + fname +
        (rmTarget ? "   [reMarkable: " + rmTarget.folder.join("/") + "/" + rmTarget.name + "]" : "   [not for reMarkable]")
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
  if (course.mode === "mirror") return discoverForMirrorCourse_(baseUrl, token, course.courseId);
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

function discoverForMirrorCourse_(baseUrl, token, courseId) {
  const folderMap = getFolderPathMap_(baseUrl, token, courseId);
  const results = {};

  // Primary source: Canvas's own Files folder structure, mirrored as-is.
  canvasGet_(baseUrl, token, "/api/v1/courses/" + courseId + "/files", { per_page: 100 }).forEach(function (f) {
    const fid = String(f.id);
    const path = folderMap[String(f.folder_id)] || [];
    results[fid] = path.length ? { kind: "mirror", path: path } : { kind: "ambiguous" };
  });

  // Safety net: anything only reachable via modules/pages/assignments/
  // announcements/syllabus (not filed into a Files folder at all).
  discoverSecondaryFileIds_(baseUrl, token, courseId).forEach(function (fid) {
    if (!(fid in results)) results[fid] = { kind: "ambiguous" };
  });

  return results;
}

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
  canvasGet_(baseUrl, token, "/api/v1/courses/" + courseId + "/pages", { per_page: 100 }).forEach(function (p) {
    const detail = canvasGet_(baseUrl, token, "/api/v1/courses/" + courseId + "/pages/" + p.url);
    if (!detail[0]) return;
    splitPageIntoSections_(detail[0].body).forEach(function (section) {
      const label = classifyPageSection_(section.headingText);
      extractFileIds_(section.html).forEach(function (fid) {
        claim(fid, label ? { kind: "fixed", path: [label] } : { kind: "ambiguous" });
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

function classifyStrayPath_(filename) {
  const lower = (filename || "").toLowerCase();
  const homeworkKw = ["homework", "hw", "problem set", "pset", "assignment", "solution", "submission"];
  const readingKw = ["reading", "pre-class", "preclass", "pre class", "case"];
  const lectureKw = ["lecture", "slide", "notes"];
  if (homeworkKw.some(function (kw) { return lower.indexOf(kw) !== -1; })) return ["Homework"];
  if (readingKw.some(function (kw) { return lower.indexOf(kw) !== -1; })) return ["Readings"];
  if (lectureKw.some(function (kw) { return lower.indexOf(kw) !== -1; })) return ["Lecture Notes"];
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

function classifyPageSection_(headingText) {
  const lower = (headingText || "").toLowerCase();
  if (lower.indexOf("pre-class") !== -1 || lower.indexOf("pre class") !== -1 || lower.indexOf("reading") !== -1) {
    return "Readings";
  }
  if (lower.indexOf("in-class") !== -1 || lower.indexOf("in class") !== -1 || lower.indexOf("lecture") !== -1 || lower.indexOf("slide") !== -1) {
    return "Lecture Notes";
  }
  return null; // unrecognized heading -- let filename-based classification decide
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
  const ext = fileExt_(filename);
  if (REMARKABLE_SKIP_EXT.indexOf(ext) !== -1) return null;
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
      if (!PREP_NAME_RE.test(name) || fileExt_(name) !== "pdf" || f.getSize() > PREP_MAX_BYTES) continue;
      if (!prepFolder) prepFolder = getOrCreateFolderPath_(remarkableClassFolder_(course), [PREP_SUBFOLDER]);

      // Each copy records the original's "last updated" time in its
      // description, so a regenerated original is spotted reliably.
      const srcStamp = String(f.getLastUpdated().getTime());
      const existing = prepFolder.getFilesByName(name);
      let updated = false;
      if (existing.hasNext()) {
        const copy = existing.next();
        if (copy.getDescription() === PREP_STAMP_PREFIX + srcStamp) continue; // up to date
        copy.setTrashed(true);
        updated = true;
      }
      f.makeCopy(name, prepFolder).setDescription(PREP_STAMP_PREFIX + srcStamp);
      lines.push("[" + course.remarkableFolder + "] Prep" + (updated ? " (updated)" : "") + " <- " + name);
    }
  });
  lines.forEach(function (l) { Logger.log(l); });
  if (lines.length) queueEmailLines_(lines);
  return lines.length + " prep sheet(s) copied or updated.";
}

/**
 * Builds the reMarkable tree from files ALREADY synced -- use once after
 * upgrading to v5 (or after changing REMARKABLE_CATEGORIES). It also
 * downloads the editable original of any Word file that older versions
 * stored only as a PDF, so Word homework is back in the course folder. Asks
 * bCourses which files exist and where they belong, finds each one in
 * Drive, and copies the qualifying ones. Because the list comes from
 * bCourses, nothing you made yourself can sneak in. Also copies the
 * scrub-filled folders (extraSourceFolders) and prep sheets.
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
        const entry = destinations[fid];
        const destPath = entry.kind === "ambiguous" ? classifyStrayPath_(fname) : entry.path;
        info = { n: fname, p: destPath };
        fileInfo[fid] = info;
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
        const done = copyToRemarkable_(course, files.next(), src.path);
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
    if (code === 403 || code === 404) return items; // tab hidden/removed -- routine
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

  canvasGet_(baseUrl, token, "/api/v1/courses/" + courseId + "/modules", {
    per_page: 100,
    "include[]": "items",
  }).forEach(function (mod) {
    (mod.items || []).forEach(function (item) {
      if (item.type === "File" && item.content_id) ids.add(String(item.content_id));
    });
  });

  canvasGet_(baseUrl, token, "/api/v1/courses/" + courseId + "/pages", { per_page: 100 }).forEach(
    function (p) {
      const detail = canvasGet_(baseUrl, token, "/api/v1/courses/" + courseId + "/pages/" + p.url);
      if (detail[0]) union_(ids, extractFileIds_(detail[0].body));
    }
  );

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

  canvasGet_(baseUrl, token, "/api/v1/courses/" + courseId + "/modules", {
    per_page: 100,
    "include[]": "items",
  }).forEach(function (mod) {
    (mod.items || []).forEach(function (item) {
      if (item.type === "File" && item.content_id) ids.add(String(item.content_id));
    });
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

// Shared by the two scrub functions: download each Canvas file into the
// given folder (skipping names already there), and copy it to reMarkable.
function scrubFilesInto_(baseUrl, token, course, folder, destPath, ids) {
  let uploaded = 0, skipped = 0, locked = 0;
  ids.forEach(function (fid) {
    const meta = getFileMetadata_(baseUrl, token, String(fid));
    if (!meta || !meta.url) { locked++; Logger.log("  locked/inaccessible: file " + fid); return; }

    const uploadName = meta.display_name;

    let file;
    const existing = folder.getFilesByName(uploadName);
    if (existing.hasNext()) {
      skipped++;
      file = existing.next();
    } else {
      file = folder.createFile(UrlFetchApp.fetch(meta.url, { muteHttpExceptions: true }).getBlob().setName(uploadName));
      uploaded++;
      Logger.log("  uploaded: " + uploadName);
    }
    if (course && course.remarkableFolder) copyToRemarkable_(course, file, destPath);
  });
  const summary = uploaded + " uploaded, " + skipped + " already there, " + locked + " locked/inaccessible.";
  Logger.log(summary);
  return summary;
}

/**
 * ONE-OFF: pulls every file linked from the Data & Decisions "Practice
 * Materials" and "More Practice Materials" pages into Data & Decisions >
 * Exams. These pages are invisible to the normal crawl (Pages tab hidden
 * for students, not linked from any Module), but fetching a page
 * directly BY SLUG still works. Covers 2023 and earlier plus the quiz
 * archive. Safe to re-run.
 */
function scrubPracticeMaterials() {
  const baseUrl = getProp_("CANVAS_BASE_URL", "https://bcourses.berkeley.edu").replace(/\/$/, "");
  const token = getProp_("CANVAS_TOKEN", null);
  if (!token) throw new Error("CANVAS_TOKEN is not set.");

  const courseId = 1555528; // MBA 200S - Data and Decisions
  const destFolderId = "1OHkZScCA7HqQ3lVgBkCbI0kY9UtwIl9J"; // Data & Decisions > Exams

  const ids = new Set();
  ["practice-materials", "more-practice-materials"].forEach(function (slug) {
    const page = canvasGet_(baseUrl, token, "/courses/" + courseId + "/pages/" + slug);
    if (page[0]) union_(ids, extractFileIds_(page[0].body));
    Logger.log("page " + slug + ": " + (page[0] ? "found" : "not reachable"));
  });

  return scrubFilesInto_(baseUrl, token, courseById_(courseId), DriveApp.getFolderById(destFolderId), ["Exams"], Array.from(ids));
}

/**
 * Trimmed first pass: the 2025 and 2024 exam sets (Final Exam + Practice
 * Final Exam, with solutions) -- 22 files. Already run once; re-running
 * is harmless. Run scrubPracticeMaterials() for 2023 and earlier.
 */
function scrubPracticeMaterials2024_2025() {
  const baseUrl = getProp_("CANVAS_BASE_URL", "https://bcourses.berkeley.edu").replace(/\/$/, "");
  const token = getProp_("CANVAS_TOKEN", null);
  if (!token) throw new Error("CANVAS_TOKEN is not set.");

  const courseId = 1555528;
  const destFolderId = "1OHkZScCA7HqQ3lVgBkCbI0kY9UtwIl9J"; // Data & Decisions > Exams
  const ids = [
    // Final Exam 2025 + solutions
    95232068, 95232067, 95232069, 95232075, 95232074, 95232077,
    // Practice Final Exam 2025 (Questions Doc / PaywiseRCT / Hypertension) + solutions
    94797481, 94797488, 94797493, 94797500, 94797499, 94797494,
    // Final Exam 2024 + solutions
    95232061, 95232065, 95232063, 95232064,
    // Practice Final Exam 2024 (Practice_Final2024 / Final MBA Data / revenues) + solutions
    94797441, 94797445, 94797337, 94797442, 95232323, 95232180,
  ];

  return scrubFilesInto_(baseUrl, token, courseById_(courseId), DriveApp.getFolderById(destFolderId), ["Exams"], ids);
}
