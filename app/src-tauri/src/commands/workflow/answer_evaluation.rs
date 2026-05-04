//! Stub module for future answer-evaluation commands (VU-1157).
//!
//! Task 2 of the workflow-artifact-storage migration intentionally leaves
//! this file empty of commands: the only persistence touched by the
//! answer-evaluator today is the per-question verdict write, which is
//! exposed as `update_clarification_verdicts` in
//! `commands/workflow/clarifications.rs`.
//!
//! Subsequent migration tasks (workflow runtime wire-up) will introduce
//! commands here for orchestrating answer-evaluation runs and persisting
//! the aggregate eval results onto the parent `clarifications` row. Until
//! then this module is a placeholder so the file path stays stable.
