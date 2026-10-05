# bcourses-remarkable-sync

A Google Apps Script that syncs course files from bCourses (UC Berkeley's Canvas instance) into organized Google Drive folders, with a filtered second copy mirrored into a `reMarkable/<class>` tree for easy import onto a reMarkable tablet.

## Why Apps Script, not a Python script + GitHub Actions

Berkeley's Google Workspace policy blocks 2-Step Verification enrollment on this account, which blocks Google Cloud Console / OAuth client self-service setup — the normal way a script running *outside* Google would authenticate to call the Drive API. Apps Script sidesteps this entirely: it runs *as* the account owner inside Google's own infrastructure, using the same in-browser "Allow" consent flow as any Docs add-on. No Cloud Console, no OAuth client, no local install.

The trade-off is that Apps Script has no native git integration — code is pasted directly into its browser editor. This repo exists to give that code real version control (this `README`, commit history, diffs) even though the script itself still has to be copy-pasted into Apps Script's editor to actually run.

## What it does

- Classifies each course's files into `Homework` / `Lecture Notes` / `Readings` / (whatever the instructor already uses), per a `mode` set per course (`mirror` recreates Canvas's own folder structure; `lecture-pages` infers structure from assignment/page content for courses with no Files-tab folders).
- Converts Word docs to PDF on the way in.
- Mirrors a filtered subset (Homework, Lecture Notes, Cases, Readings, Exams) into a flat `reMarkable/<class>` folder per course, as an additive copy — never replacing the main per-course structure.
- Tracks per-file sync state in a small JSON file in Drive, so a crash mid-run never causes duplicate re-uploads.
- Runs on two daily Apps Script time-driven triggers — no laptop, no GitHub Actions, no server.

## Files

- `apps-script/Code.gs` — the full, current script. Paste this into the Apps Script editor for the project (Extensions → Apps Script, from a Drive-connected context, or script.google.com directly).

## Setup

Full one-time setup steps (Script Properties, time zone, triggers, the one-off backfill/prune functions) are documented in the docstring at the top of `apps-script/Code.gs`.

## History

Each functional change to the sync logic is its own commit — see `git log` for the full story of how the reMarkable mirror went from "copy everything" to a filtered, category-aware mirror.
