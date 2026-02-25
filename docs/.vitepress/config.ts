import { defineConfig } from "vitepress";

export default defineConfig({
  title: "Skill Builder",
  description: "User guide for Skill Builder",
  base: "/skill-builder/",
  srcDir: ".",
  srcExclude: ["**/node_modules/**", "design/**"],

  themeConfig: {
    nav: [{ text: "User Guide", link: "/user-guide/" }],

    sidebar: [
      {
        text: "User Guide",
        items: [
          { text: "Getting Started", link: "/user-guide/" },
          { text: "Dashboard", link: "/user-guide/dashboard" },
          {
            text: "Building a Skill",
            collapsed: false,
            items: [
              { text: "Workflow overview", link: "/user-guide/workflow/overview" },
              { text: "Step 1: Research", link: "/user-guide/workflow/step-1-research" },
              { text: "Step 2: Detailed Research", link: "/user-guide/workflow/step-2-detailed-research" },
              { text: "Step 3: Confirm Decisions", link: "/user-guide/workflow/step-3-confirm-decisions" },
              { text: "Step 4: Generate Skill", link: "/user-guide/workflow/step-4-generate-skill" },
            ],
          },
          { text: "Refine", link: "/user-guide/refine" },
          { text: "Test", link: "/user-guide/test" },
          { text: "Settings", link: "/user-guide/settings" },
          { text: "Usage", link: "/user-guide/usage" },
        ],
      },
    ],

    socialLinks: [
      { icon: "github", link: "https://github.com/hbanerjee74/skill-builder" },
    ],

    footer: {
      message: "Skill Builder user documentation",
    },
  },
});
