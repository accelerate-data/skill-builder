export const GENERATED_DESCRIPTION_EVAL_QUERIES = [
  {
    query: "Use the skill to audit dbt model freshness and source coverage.",
    should_trigger: true,
  },
  {
    query: "Generate a semantic model checklist for analytics engineers.",
    should_trigger: true,
  },
  {
    query: "Summarize this marketing email in three bullets.",
    should_trigger: false,
  },
  {
    query: "Write a vacation itinerary for Singapore.",
    should_trigger: false,
  },
];

export const DESCRIPTION_OPTIMIZATION_RESULT = {
  iterations_run: 2,
  original_description: "Use when doing dbt work.",
  best_description:
    "Use when the user needs analytics engineering help with dbt models, semantic models, data quality checks, or source freshness.",
  history: [
    {
      iteration: 0,
      description: "Use when doing dbt work.",
      train_passed: null,
      train_total: null,
      test_passed: 1,
      test_total: 4,
    },
    {
      iteration: 1,
      description: "Use when the user needs dbt and analytics engineering help.",
      train_passed: 3,
      train_total: 4,
      test_passed: 3,
      test_total: 4,
    },
    {
      iteration: 2,
      description:
        "Use when the user needs analytics engineering help with dbt models, semantic models, data quality checks, or source freshness.",
      train_passed: 4,
      train_total: 4,
      test_passed: 4,
      test_total: 4,
    },
  ],
};
