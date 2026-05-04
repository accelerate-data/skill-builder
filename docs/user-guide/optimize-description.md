# Trigger Mode

Description tuning now lives under **Eval Workbench → Trigger**.

Use **Trigger** mode when a skill fires too often, misses requests it should catch, or needs a tighter trigger boundary.

Use it when a skill is triggered too often, not triggered when it should be, or has a description that is too broad or too vague.

## What's on this screen

The mode has three main areas:

- **Trigger Eval Queries** — example requests split into **Should Trigger** and **Should Not Trigger**
- **Trigger comparison** — runs the candidate comparison loop
- **Results** — shows score progression, the before/after description, and actions for the best result

## Generate trigger eval queries

1. Open a skill and switch to **Eval Workbench**.
2. Select **Trigger**.
3. Click **Generate candidates**.

Generated candidates appear under the baseline description so you can compare wording before running the trigger pass.

## Edit trigger cases

Each query belongs in one of two columns:

- **Should Trigger** — requests that should invoke the skill
- **Should Not Trigger** — requests that should not invoke the skill

You can edit each saved case directly, switch **Should trigger** on or off, add cases, and delete cases before saving the prompt set.

## Run trigger comparison

1. Make sure at least one query is in **Should Trigger**.
2. Click **Run comparison**.
3. Review the baseline plus generated candidates after the run completes.

Click **Cancel** to stop an active comparison run.

If every case is marked as not triggering, the mode cannot produce a useful trigger comparison.

## Apply the recommended description

When comparison completes, the mode shows:

- the baseline description
- generated candidates
- pass summaries from the completed run
- a **Recommended** marker on the strongest candidate

Click **Apply** on a candidate card to save that description.

## What you'll see

- **Empty query state** — **No queries yet. Generate or add them manually.**
- **Generation running** — candidate generation is in progress
- **Comparison running** — a comparison run is in progress with progress text and **Cancel**
- **Navigation guard** — **Process Running** with **Stay** and **Leave** when you try to leave during an active run

## Quick reference

| Control | What it does |
|---|---|
| **Generate candidates** | Creates trigger-description alternatives from the current prompt set |
| **Run comparison** | Compares the baseline plus generated candidates |
| **Cancel** | Stops an active comparison run |
| **Apply** | Saves a selected description candidate |
