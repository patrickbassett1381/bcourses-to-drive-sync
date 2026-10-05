/**
 * bCourses -> Google Drive sync, running entirely inside Google Apps
 * Script under your berkeley.edu account. No Cloud Console, no GitHub,
 * no local install -- this sidesteps the 2-Step Verification block on
 * Cloud Console because Apps Script never touches Cloud Console at all;
 * it runs as you, using the same in-browser "Allow" consent Google
 * Docs add-ons use.
 *
 * ---- Per-course classification ----
 *
 * Each course in COURSES has a `mode`:
 *
 *  - "mirror": Canvas's own Files-tab folder structure is recreated
 *    as-is in Drive (whatever folder names the instructor already
 *    uses -- Homework, Lecture Notes, Case Studies, whatever). Use
 *    this when a course already organizes its Files tab into folders
 *    (Accounting, Leading People).
 *
 *  - "lecture-pages": for courses with no Files-tab folder structure
 *    (Data & Decisions, Econ). Files linked from the Assignments
 *    section land in a `Homework` folder. Files linked from Canvas
 *    Pages (lecture pages) are split by the page's own section
 *    headings: a "Pre-Class Reading" section lands in `Readings`, an
 *    "In-Class Lecture Slides" section lands in `Lecture Notes`. If a
 *    page has no heading Claude can match, its files fall back to
 *    filename-based classification instead of a guess.
 *
 * In both modes, anything found but NOT confidently classified (a
 * stray Modules/Announcements/syllabus attachment, or a Files-tab
 * item sitting outside any real subfolder) goes into an
 * `Unsorted - Review` folder per course instead of a guess.
 *
 * ---- One-time setup ----
 *
 * 1. Fill in driveFolderId and mode for each course in COURSES below
 *    (see SETUP_APPSSCRIPT.md step 6 for how to create those folders
 *    and find their IDs).
 *
 * 2. Project Settings (gear icon, left sidebar) -> Script Properties ->
 *    add a property:
 *      CANVAS_TOKEN = <your bCourses personal access token>
 *    (CANVAS_BASE_URL defaults to bcourses.berkeley.edu below, so you
 *    don't need to set it unless that's wrong.)
 *
 * 3. Same Project Settings screen -> General -> Time zone ->
 *    America/Los_Angeles.
 *
 * 4. Select `dryRun` in the function dropdown at the top and click Run.
 *    This is the first network call the project makes, so Google will
 *    show an authorization prompt -- click through it and Allow. Check
 *    the execution log (View > Logs, or Ctrl+Enter) for what it found,
 *    including the destination folder path it would use for each file.
 *
 * 5. Once dryRun looks right, run `runSync` once manually the same way
 *    to do a real pass.
 *
 * 6. Triggers (clock icon, left sidebar) -> Add Trigger -> function
 *    `runSync` -> Time-driven -> Day timer -> 6am to 7am -> Save.
 *    Then Add Trigger again -> function `runSync` -> Time-driven ->
 *    Day timer -> 9pm to 10pm -> Save. That gives you two checks a
 *    day; Apps Script fires sometime within the chosen hour, not at
 *    an exact minute. From here it runs on its own, no laptop or
 *    GitHub involved.
 */

// ---- Configuration -------------------------------------------------

// Send yourself a short email only on days something new actually
// synced (never an empty "nothing happened" email).
const SEND_EMAIL_SUMMARY = true;

const COURSES = [
  {
    courseId: 1555528,
    name: "MBA 200S - Data and Decisions",
    driveFolderId: "1PfgvpL42ilvaqXNATq8_Bw4GR_qYkPem",
    mode: "lecture-pages",
    includeExt: ["pdf", "pptx", "docx", "xlsx"],
    excludeKeywords: ["syllabus", "roster"],
  },
  {
    courseId: 1555514,
    name: "MBA 201A - Economics for Business Decision Making",
    driveFolderId: "1VyWcWOHZLlfEpqWtcecDoBYYvEQYbnSe",
    mode: "lecture-pages",
    includeExt: ["pdf", "pptx", "docx", "xlsx"],
    excludeKeywords: ["syllabus", "roster"],
  },
  {
    courseId: 1555594,
    name: "MBA 202 - Financial Accounting",
    driveFolderId: "1_3YlYxTNJck7E9fbNM4i0gtwe4RTFPvL",
    mode: "mirror",
    includeExt: ["pdf", "pptx", "docx", "xlsx"],
    excludeKeywords: ["syllabus", "roster"],
  },
  {
    courseId: 1555298,
    name: "MBA 205 - Leading People",
    driveFolderId: "1JrTl0EZHo04iq0FU-9OCd6iiHP9sYs43",
    mode: "mirror",
    includeExt: ["pdf", "pptx", "docx", "xlsx"],
    excludeKeywords: ["syllabus", "roster"],
  },
];

// Where the small sync-state JSON file lives. Defaults to the first
// course's folder so there's nothing extra to configure; point it at
// your top-level "Haas MBA Materials" folder ID instead if you'd
// rather keep it out of a course folder.
function stateParentFolderId_() {
  return COURSES[0].driveFolderId;
}
const STATE_FILENAME = "_bcourses_sync_state.json";

const UNSORTED_FOLDER_NAME = "Unsorted - Review";

// ---- Entry points ----------------------------------------------------

function runSync() {
  return sync_(/* dry = */ false);
}

// Reports what WOULD sync (including destination folder path) with
// zero side effects -- no Drive writes, no state changes, no email.
// Run this first, and any time you change COURSES, to sanity-check
// before trusting it with real uploads.
function dryRun() {
  return sync_(/* dry = */ true);
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
      // Canvas can return 200 with real metadata for a file that's
      // still locked for you (a date-locked reading, or one behind a
      // module prerequisite you haven't completed) -- in that case it
      // omits `url` rather than returning 403/404. Treat a missing url
      // the same as an inaccessible file: skip it now, leave it out of
      // `synced`, and pick it up automatically once it unlocks.
      if (!meta || !meta.url) return;

      const fname = meta.display_name;
      if (!matchesFilters_(fname, course.includeExt, course.excludeKeywords)) {
        if (!dry) synced.add(fid); // doesn't match what we want -- stop re-checking it
        return;
      }

      const entry = destinations[fid];
      const destPath = entry.kind === "ambiguous" ? classifyStrayPath_(fname) : entry.path;

      newCount++;
      Logger.log((dry ? "  WOULD SYNC: " : "  NEW: ") + destPath.join("/") + "/" + fname);

      if (!dry) {
        const courseRoot = DriveApp.getFolderById(course.driveFolderId);
        const folder = getOrCreateFolderPath_(courseRoot, destPath);

        // Word docs get converted to PDF before landing in Drive --
        // PDF is what's actually usable once it reaches the reMarkable
        // side of things, and a .docx is not. This changes the stored
        // filename's extension, so the "already there" check below
        // has to test against that final name, not the original one.
        const isWord = /\.docx?$/i.test(fname);
        const uploadName = isWord ? fname.replace(/\.docx?$/i, ".pdf") : fname;

        // Belt-and-suspenders against the state file and Drive's actual
        // contents ever disagreeing (exactly what a mid-run crash can
        // cause): check Drive itself, not just our own bookkeeping,
        // before uploading. A same-name match is treated as "already
        // there" and skipped, so a crash-and-retry can no longer
        // produce duplicate copies.
        if (folder.getFilesByName(uploadName).hasNext()) {
          Logger.log("  (already in Drive, skipping): " + uploadName);
        } else {
          const resp = UrlFetchApp.fetch(meta.url, { muteHttpExceptions: true });
          const rawBlob = resp.getBlob();
          const finalBlob = isWord
            ? convertDocxToPdf_(rawBlob.getBytes(), fname).setName(uploadName)
            : rawBlob.setName(uploadName);
          folder.createFile(finalBlob);
        }
        synced.add(fid);
        // Saved after EVERY successful upload, not just at the end of
        // the course. A first sync can be a large backlog, each upload
        // takes real time, and an unhandled error partway through (a
        // Canvas quirk, a flaky network call) is a real possibility,
        // not a hypothetical. Without per-file saving, retrying after
        // a crash would re-download and duplicate every file that had
        // already succeeded.
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

  if (!dry) {
    if (SEND_EMAIL_SUMMARY && totalNew > 0) {
      MailApp.sendEmail(
        Session.getActiveUser().getEmail(),
        "bCourses sync: " + totalNew + " new file(s)",
        summaryLines.join("\n")
      );
    }
  }

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
  // announcements/syllabus (not filed into a Files folder at all) --
  // Accounting and Leading People mostly won't need this, but nothing
  // gets silently dropped if a file lives outside the Files tab.
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

  // Lecture Pages: split by the page's own section headings rather
  // than dumping the whole page into one bucket -- "Pre-Class Reading"
  // sections go to Readings, "In-Class ... Slides" sections go to
  // Lecture Notes. A page with no heading we can confidently match
  // falls back to filename-based classification (kind: "ambiguous").
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

  // Everything else -- direct Files-tab items, module file items,
  // announcements, syllabus -- has no reliable signal here, so it's
  // classified by filename once metadata is fetched.
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
  const readingKw = ["reading", "pre-class", "preclass", "pre class"];
  const lectureKw = ["lecture", "slide", "notes", "case"];
  if (homeworkKw.some(function (kw) { return lower.indexOf(kw) !== -1; })) return ["Homework"];
  if (readingKw.some(function (kw) { return lower.indexOf(kw) !== -1; })) return ["Readings"];
  if (lectureKw.some(function (kw) { return lower.indexOf(kw) !== -1; })) return ["Lecture Notes"];
  return [UNSORTED_FOLDER_NAME];
}

// Splits a Canvas Page's raw HTML body into chunks at each heading tag
// (<h1>-<h4>), pairing each chunk with the heading text that precedes
// it. The first chunk (before any heading) carries headingText "".
// Regex-based rather than a real HTML parser -- Apps Script has no
// DOMParser and Canvas's RCE output isn't guaranteed well-formed XML --
// but Canvas page headings are reliably <hN> tags, so this holds up
// for the common case and degrades to "ambiguous" (never a silent
// misfile) when a page doesn't use headings at all.
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

// ---- Canvas discovery --------------------------------------------------
// Same approach as a Berkeley classmate's bcourses-cli tool: many
// instructors switch the Files tab off entirely (Canvas returns 403 for
// that -- routine, not an error), while the same PDFs are still linked
// from module items, page bodies, assignment descriptions, announcements,
// or the syllabus. Hitting only /files misses those; this walks all of
// the above and merges the file IDs it finds.

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

// Full secondary sweep -- modules, pages, assignments, announcements,
// syllabus -- used as the "don't lose anything" safety net for mirror
// courses (which don't otherwise scan these sources at all).
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

// Lean sweep -- just modules, announcements, syllabus -- used by
// lecture-pages courses, which already scan pages/assignments
// separately for confident classification and don't need those two
// fetched a second time.
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
  const dot = filename.lastIndexOf(".");
  const ext = dot === -1 ? "" : filename.substring(dot + 1).toLowerCase();
  if (includeExt && includeExt.indexOf(ext) === -1) return false;
  const lower = filename.toLowerCase();
  return !(excludeKeywords || []).some(function (kw) {
    return lower.indexOf(kw.toLowerCase()) !== -1;
  });
}

// ---- Word -> PDF conversion --------------------------------------------
// Deliberately avoids the Advanced Drive Service (Apps Script's "Services
// +" panel) since enabling it can, on some setups, bounce you back into
// Cloud Console -- exactly what we're trying to stay away from. This
// instead calls the plain Drive v3 REST API directly with the token the
// script already has (the same permission DriveApp itself uses), asking
// Drive to convert an uploaded .docx into a native Google Doc, exporting
// that as a PDF, and deleting the intermediate Google Doc so only the
// PDF is left behind in your course folder.

function convertDocxToPdf_(bytes, originalFilename) {
  const boundary = "bcourses_sync_boundary";
  const metadata = {
    name: originalFilename,
    mimeType: "application/vnd.google-apps.document", // asks Drive to convert on upload
  };
  // Legacy .doc (binary format) and modern .docx use different source
  // MIME types -- Drive's conversion is more reliable when this
  // matches the file's actual format rather than always assuming .docx.
  const sourceMimeType = /\.doc$/i.test(originalFilename)
    ? "application/msword"
    : "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

  const bodyString =
    "--" + boundary + "\r\n" +
    "Content-Type: application/json; charset=UTF-8\r\n\r\n" +
    JSON.stringify(metadata) + "\r\n" +
    "--" + boundary + "\r\n" +
    "Content-Type: " + sourceMimeType + "\r\n" +
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
    throw new Error("Docx-to-Doc conversion failed: " + createResp.getContentText());
  }

  const tempDocId = JSON.parse(createResp.getContentText()).id;
  const tempDoc = DriveApp.getFileById(tempDocId);
  try {
    return tempDoc.getAs(MimeType.PDF);
  } finally {
    tempDoc.setTrashed(true); // clean up the intermediate Google Doc either way
  }
}

// ---- State: a small JSON file kept in Drive itself ----------------------
// (Not Script Properties -- those cap out around 9KB per value, which a
// semester's worth of synced file IDs could realistically approach.)

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
    DriveApp.getFolderById(stateParentFolderId_()).createFile(
      STATE_FILENAME,
      content,
      MimeType.PLAIN_TEXT
    );
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

 /**
 * ONE-OFF: pulls every file linked from the Data & Decisions "Practice
 * Materials" and "More Practice Materials" pages into a fixed Drive
 * folder. Not part of the daily runSync -- these two pages are invisible
 * to the normal crawl because the Pages tab is hidden for students on
 * this course (same kind of tab-toggle-off Canvas does for Files), and
 * neither page is linked from any Module either, so there is no path
 * discoverFileIds_ can reach them by. Fetching a page directly BY SLUG
 * still works even with the tab hidden -- it's only the *listing* that's
 * blocked -- which is what this relies on.
 *
 * Paste this into the same Code.gs project (it reuses canvasGet_,
 * extractFileIds_, getFileMetadata_, convertDocxToPdf_, getProp_, which
 * are all already defined there). Select `scrubPracticeMaterials` in the
 * function dropdown and Run. Safe to re-run -- it checks the destination
 * folder by filename before uploading, so nothing duplicates.
 */
function scrubPracticeMaterials() {
  const baseUrl = getProp_("CANVAS_BASE_URL", "https://bcourses.berkeley.edu").replace(/\/$/, "");
  const token = getProp_("CANVAS_TOKEN", null);
  if (!token) throw new Error("CANVAS_TOKEN is not set.");

  const courseId = 1555528; // MBA 200S - Data and Decisions
  // Destination folder created ahead of time: Data & Decisions > Exams
  const destFolderId = "1OHkZScCA7HqQ3lVgBkCbI0kY9UtwIl9J";

  const slugs = ["practice-materials", "more-practice-materials"];
  let ids = new Set();
  slugs.forEach(function (slug) {
    const page = canvasGet_(baseUrl, token, "/courses/" + courseId + "/pages/" + slug);
    if (page[0]) union_(ids, extractFileIds_(page[0].body));
    Logger.log("page " + slug + ": " + (page[0] ? "found, " + extractFileIds_(page[0].body).size + " file link(s)" : "not reachable"));
  });

  const folder = DriveApp.getFolderById(destFolderId);
  let uploaded = 0, skipped = 0, locked = 0;

  ids.forEach(function (fid) {
    const meta = getFileMetadata_(baseUrl, token, fid);
    if (!meta || !meta.url) { locked++; return; }

    const fname = meta.display_name;
    const isWord = /\.docx?$/i.test(fname);
    const uploadName = isWord ? fname.replace(/\.docx?$/i, ".pdf") : fname;

    if (folder.getFilesByName(uploadName).hasNext()) {
      skipped++;
      return;
    }

    const resp = UrlFetchApp.fetch(meta.url, { muteHttpExceptions: true });
    const rawBlob = resp.getBlob();
    const finalBlob = isWord
      ? convertDocxToPdf_(rawBlob.getBytes(), fname).setName(uploadName)
      : rawBlob.setName(uploadName);
    folder.createFile(finalBlob);
    uploaded++;
    Logger.log("  uploaded: " + uploadName);
  });

  const summary = uploaded + " uploaded, " + skipped + " already there, " + locked + " locked/inaccessible.";
  Logger.log(summary);
  return summary;
}

/**
 * Trimmed first pass: just the 2025 and 2024 exam sets (both the real
 * Final Exam and its "Practice Final Exam" companion set) from the
 * Practice Materials page -- 22 files total. IDs taken directly from
 * the page body already read, so this skips the page fetch entirely.
 * Same dedupe-by-filename safety as the full version. Run this first;
 * run scrubPracticeMaterials() afterward to pick up 2023 and earlier.
 */
function scrubPracticeMaterials2024_2025() {
  const baseUrl = getProp_("CANVAS_BASE_URL", "https://bcourses.berkeley.edu").replace(/\/$/, "");
  const token = getProp_("CANVAS_TOKEN", null);
  if (!token) throw new Error("CANVAS_TOKEN is not set.");

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

  const folder = DriveApp.getFolderById(destFolderId);
  let uploaded = 0, skipped = 0, locked = 0;

  ids.forEach(function (fid) {
    const meta = getFileMetadata_(baseUrl, token, String(fid));
    if (!meta || !meta.url) { locked++; Logger.log("  locked/inaccessible: file " + fid); return; }

    const fname = meta.display_name;
    const isWord = /\.docx?$/i.test(fname);
    const uploadName = isWord ? fname.replace(/\.docx?$/i, ".pdf") : fname;

    if (folder.getFilesByName(uploadName).hasNext()) {
      skipped++;
      Logger.log("  already there, skipping: " + uploadName);
      return;
    }

    const resp = UrlFetchApp.fetch(meta.url, { muteHttpExceptions: true });
    const rawBlob = resp.getBlob();
    const finalBlob = isWord
      ? convertDocxToPdf_(rawBlob.getBytes(), fname).setName(uploadName)
      : rawBlob.setName(uploadName);
    folder.createFile(finalBlob);
    uploaded++;
    Logger.log("  uploaded: " + uploadName);
  });

  const summary = uploaded + " uploaded, " + skipped + " already there, " + locked + " locked/inaccessible.";
  Logger.log(summary);
  return summary;
}
