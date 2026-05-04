# Eval Workbench

The **Evals** workspace tab opens the **Eval Workbench**, the app's current in-app path for testing skill output quality. It stores app-owned prompt sets, run history, and run details for the selected skill. When a run exposes weak output, you can send an improvement brief directly to [Refine](refine.md).

## Open the workbench

1. Select a skill in the dashboard.
2. Open the skill workspace.
3. Switch to the **Evals** tab.

## What's on this screen

The page has three main sections:

- **Eval Workbench** header with a **Run prompt set** button.
- **Prompt set** editor where you create and save app-owned evaluation cases.
- **Run history** and **Run details** for reviewing completed runs and sending feedback to Refine.

## Create or update a prompt set

1. Open **Evals**.
2. In **Prompt set**, click **New prompt set** if you want a fresh draft.
3. Enter a **Prompt set name**.
4. For each case, fill in **Case prompt** and **Expected outcome**.
5. Click **Add case** to include more cases, or delete a case with the trash button.
6. Click **Save prompt set**.

Saved prompt sets appear as buttons near the top of the page. Click a prompt set name to load it back into the editor.

## Run a prompt set

1. Open **Evals**.
2. Select the prompt set you want to run.
3. Click **Run prompt set**.

The workbench adds the run to **Run history** and loads its results into **Run details** when the run finishes.

## Review run history and results

Use **Run history** to inspect prior runs:

- **View latest run** opens the newest run.
- **View run** opens any older run.
- Each row shows the run ID, status, and passed/total summary.

Use **Run details** to inspect case-by-case results:

- **Case** shows the saved case ID.
- **Target** shows the candidate that was graded.
- **Score** and **Status** show the recorded result.
- **Reason** explains why a case failed when the grader returned one.

If no run is selected, the page shows **Select a run to inspect its case results**.

## Send run feedback to Refine

1. Open a completed run from **Run history**.
2. Review failures in **Run details**.
3. Click **Send to Refine**.

The workbench builds an improvement brief from that run and opens the [Refine](refine.md) tab with the brief ready to use.

## What you'll see

- **No workspace** — **Configure a workspace before using Eval Workbench.**
- **Loading** — **Loading Eval Workbench…**
- **Load error** — an error message with **Retry**
- **No runs yet** — **No runs yet.**
- **No selected run** — **Select a run to inspect its case results.**
- **No recorded results** — **This run has no recorded case results yet.**

## Quick reference

| Control | What it does |
|---|---|
| **Run prompt set** | Starts a run for the selected saved prompt set |
| **New prompt set** | Clears the editor for a new prompt-set draft |
| **Prompt set name** | Names the saved set of cases |
| **Case prompt** | The request the skill should answer |
| **Expected outcome** | The expected response or behavior |
| **Add case** | Adds another case to the prompt set |
| **Save prompt set** | Persists the current prompt set |
| **View latest run** | Opens the newest run in **Run details** |
| **View run** | Opens an older run in **Run details** |
| **Send to Refine** | Builds an improvement brief and opens Refine |
