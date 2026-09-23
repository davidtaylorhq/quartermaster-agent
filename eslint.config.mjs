import DiscourseRecommended from "@discourse/lint-configs/eslint";

export default [
  ...DiscourseRecommended,
  {
    // These are command line programs, and the run's log is what they write to.
    rules: { "no-console": "off" },
  },
  {
    ignores: ["vendor/", "node_modules/"],
  },
];
