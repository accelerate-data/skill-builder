import { defineConfig } from "vitepress";

export default defineConfig({
  title: "Skill Builder",
  description: "User guide for Skill Builder",
  base: "/skill-builder/",
  srcDir: "user-guide",

  themeConfig: {
    nav: [{ text: "User Guide", link: "/" }],

    sidebar: [
      {
        text: "User Guide",
        items: [
          { text: "Getting Started", link: "/" },
          { text: "Dashboard", link: "/dashboard" },
          {
            text: "Building a Skill",
            collapsed: false,
            items: [
              { text: "Workflow overview", link: "/workflow/overview" },
              { text: "Step 1: Research", link: "/workflow/step-1-research" },
              { text: "Step 2: Detailed Research", link: "/workflow/step-2-detailed-research" },
              { text: "Step 3: Confirm Decisions", link: "/workflow/step-3-confirm-decisions" },
              { text: "Step 4: Generate Skill", link: "/workflow/step-4-generate-skill" },
            ],
          },
          { text: "Refine", link: "/refine" },
          { text: "Test", link: "/test" },
          { text: "Settings", link: "/settings" },
          { text: "Usage", link: "/usage" },
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
