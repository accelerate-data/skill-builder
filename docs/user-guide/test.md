# Evals

The **Evals** workspace tab lets you define test scenarios for a skill, run them, review benchmark results, and use failures to start a Refine request.

You can reach it from:

- **More actions → Eval** on a skill in the dashboard skill list
- the **Evals** tab inside the selected skill's workspace shell
- **Eval** after Step 4 finishes in the workflow

## What's on this screen

The top section is **Evals**. It lists saved evals from the selected skill and shows each eval's **Name**, **Prompt**, and assertion count.

When evals exist, the run controls appear above the list:

- selection checkbox
- **None** / **vs Baseline**
- **1×** / **3×**
- **Run selected (N)**

The lower sections appear after runs:

- live agent output while evals are running
- benchmark results after a run completes
- **Iteration History** for previous runs

## Generate an eval

1. Open the skill and switch to **Evals**.
2. Click **Generate eval**.
3. In **Generate eval**, answer **What do you want to evaluate?**
4. Click **Generate**.
5. Review the generated eval in **Review Generated Eval**.
6. Edit **Name**, **Prompt**, and **Expectations** if needed.
7. Click **Add**.

The generation dialog shows **Generating eval...** while the agent reads the skill definition and drafts the scenario. Click **Cancel** to stop before the eval is created.

## Edit or delete an eval

1. Open **Evals**.
2. Click the pencil button on a row to open **Edit Eval**.
3. Update **Name**, **Prompt**, or **Expectations**.
4. Click **Save changes**.

To remove an eval, click the trash button, then confirm **Delete** in **Delete eval?**.

## Run evals

1. Select one or more evals with the checkboxes.
2. Choose **None** for a normal run, or **vs Baseline** to compare against a no-skill baseline.
3. Choose **1×** or **3×**.
4. Click **Run selected (N)**.

While the run is active, the button changes to **Running…** and the page shows **Running evals — grading results appear below as they complete**.

## Review results and refine

After a run completes, the benchmark card summarizes the result. If assertions fail, the page shows **Refine skill**.

Click **Refine skill** to send the failing eval context to the [Refine](refine.md) tab. If the eval run is still active, the app shows **Eval Run In Progress** and asks whether to **Stay** or **Cancel eval and refine**.

## What you'll see

- **Empty state** — **No evals yet** with **Generate your first eval**.
- **Loading** — **Loading evals…** while evals are being read.
- **Generation running** — **Generating eval for "..."…** and the agent output panel.
- **Run running** — **Running evals — grading results appear below as they complete**.
- **Navigation guard** — **Eval Run In Progress** with **Stay** and **Leave** when you try to navigate away during a run.

## Quick reference

| Control | What it does |
|---|---|
| **Generate eval** | Opens the intent dialog for a new eval |
| **Generate your first eval** | Starts eval generation from the empty state |
| **Name** | Human-readable eval name |
| **Prompt** | User request the skill should handle |
| **Expectations** | Assertions the result should satisfy |
| **Add expectation** | Adds another assertion field |
| **None** | Runs selected evals without a baseline comparison |
| **vs Baseline** | Compares skill output against a no-skill baseline |
| **1×** / **3×** | Controls how many times selected evals run |
| **Run selected (N)** | Starts the selected eval run |
| **Refine skill** | Opens Refine with failing eval context |
