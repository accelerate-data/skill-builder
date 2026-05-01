# Optimize Description

The **Optimize Description** workspace tab helps tune the description that decides when Claude should trigger a skill.

Use it when a skill is triggered too often, not triggered when it should be, or has a description that is too broad or too vague.

## What's on this screen

The page has three main areas:

- **Trigger Eval Queries** — example requests split into **Should Trigger** and **Should Not Trigger**
- **Optimize Description** — runs the optimization loop
- **Results** — shows score progression, the before/after description, and actions for the best result

## Generate trigger eval queries

1. Open a skill and switch to **Optimize Description**.
2. Click **Generate** in **Trigger Eval Queries**.
3. In **Generate Eval Queries**, enter the **Number of queries**. The minimum is 10 and the recommended value is 20.
4. Click **Generate**.

While queries are generating, the dialog shows **Generating Eval Queries** and the agent output panel. Click outside the dialog or press `Esc` to open **Stop generating?**.

## Edit trigger eval queries

Each query belongs in one of two columns:

- **Should Trigger** — requests that should invoke the skill
- **Should Not Trigger** — requests that should not invoke the skill

You can:

1. Edit any query text directly.
2. Use the **Should trigger** switch to move a query between the two columns.
3. Click **Add query** to add a row.
4. Click the trash button to delete a row.

The tab saves query edits after at least one query exists.

## Run optimization

1. Make sure at least one query is in **Should Trigger**.
2. Click **Optimize**.
3. Watch **Iteration**, **Train score**, **Test score**, and **Best so far** as the run progresses.

The run can take several iterations. Click **Cancel** to stop it.

If every query is marked as not triggering, the page shows **Enable at least one query to run optimization.**

## Apply the best description

When optimization completes, **Results** shows:

- **Score Progression**
- **Description diff — original vs best**
- **Before (Original)**
- **After (Best)**

Click **Apply best description** to save the recommended description. A success message appears: **Description applied successfully.**

Click **Discard** to close the result without applying it.

## What you'll see

- **Empty query state** — **No queries yet. Generate or add them manually.**
- **Generation running** — **Generating Eval Queries** with live agent output.
- **Optimization running** — **Iteration N / 5** and **Running 3x eval queries on iteration N description…**
- **Cancel generation guard** — **Stop generating?** with **Continue generating** and **Stop**.
- **Navigation guard** — **Optimization In Progress** with **Stay** and **Leave** when you try to leave during an optimization run.

## Quick reference

| Control | What it does |
|---|---|
| **Generate** | Generates trigger eval queries |
| **Number of queries** | Sets how many queries to generate |
| **Should Trigger** | Requests that should invoke the skill |
| **Should Not Trigger** | Requests that should not invoke the skill |
| **Should trigger** | Moves a query between trigger and non-trigger groups |
| **Add query** | Adds another query row |
| **Optimize** | Starts description optimization |
| **Cancel** | Stops an optimization run |
| **Apply best description** | Saves the best generated description |
| **Discard** | Closes the optimization result without applying it |
