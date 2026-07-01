/**
 * Reel templates seed — 10 niche presets covering the creator-economy CPM landscape.
 *
 * Insertion pattern: run this from a migration or admin script.
 *   import { seedReelTemplates } from "@paperclip/db/seeds/reel-templates";
 *   await seedReelTemplates(db);
 *
 * Each template carries niche-specific:
 *   - Hook patterns (proven viral structures for that niche in 2026)
 *   - Banned words (compliance — words that auto-reject the script)
 *   - Required disclaimer (auto-appended to caption, e.g. "Not financial advice")
 *   - Recommended models per clip type (talking-head / B-roll / product-shot)
 *   - Compatible personas (which of our synthetic AI characters brand-fit)
 *   - Compliance check prompt (run before fire to catch policy violations)
 *
 * Templates are PERSONA-AGNOSTIC by design. Any persona can fire any template —
 * the visual identity (persona) and the content format (template) are orthogonal
 * inputs at fire time. Don't lock them. A Raven legal-explainer reel is fine
 * as long as the script clears the compliance check.
 *
 * `compatiblePersonas: []` everywhere = no opinion. If we ever want soft brand-fit
 * hints (warnings, not blocks), we can populate later — but the system NEVER
 * prevents firing a (persona, template) combination.
 */
import type { InferInsertModel } from "drizzle-orm";
import { reelTemplates } from "../schema/reels.js";

type NewReelTemplate = InferInsertModel<typeof reelTemplates>;

/**
 * Common compliance check prompt prefix — niche-specific text gets appended.
 */
const COMPLIANCE_CHECK_BASE = `You are a content compliance reviewer. Read the following reel script and determine if it crosses into advisory/recommendation territory rather than educational/informational content. If the script contains specific actionable recommendations in this niche, return ONLY the word REJECT followed by a brief explanation and an educational rewrite suggestion. If the script is safely educational, return only the word PASS.

Niche-specific rules:`;

/**
 * Common FTC AI-disclosure tag appended when the persona is synthetic.
 */
const AI_DISCLOSURE = "AI-generated content. ";

export const REEL_TEMPLATES: NewReelTemplate[] = [
  // ============================================================
  // 1. FINANCE / INVESTING — high CPM, high compliance risk
  // ============================================================
  {
    niche: "finance",
    name: "Money Mindset — Educational",
    description:
      "Personal-finance education only. No specific stocks, no buy/sell recommendations. Frames as 'things broke vs rich girls do.'",
    stylePreset: "explainer_glow",
    durationSeconds: 18,
    aspectRatio: "9:16",
    defaultMusicMood: "confident_upbeat",
    defaultVideoProvider: "atlas_seedance",
    promptScaffold: `Hook (1.5s): "{HOOK_LINE}" — must be a contrarian observation or transformation framing, NEVER a stock pick or "buy this" call.
Beat 2 (4s): Educational principle (e.g., compound interest, budget categories, credit utilization).
Beat 3 (4s): Concrete example without naming specific products.
Beat 4 (4s): Mindset reframe — "rich girls think...".
Payoff (4s): Save-for-later CTA.

NEVER include: specific stock tickers, "I recommend," "guaranteed returns," "buy this," "sell that," names of specific brokerages as endorsements.`,
    metadata: {
      hookPatterns: [
        "3 things rich girls don't tell broke girls about money",
        "POV: you finally understand how credit actually works",
        "I wish someone told me this about [topic] at 22",
      ],
      sceneCount: 5,
      targetCutDurationSeconds: 2.0,
      bannedWords: [
        "buy",
        "sell",
        "recommend",
        "guaranteed",
        "best stock",
        "trade",
        "should invest in",
        "this is a no-brainer",
      ],
      requiredDisclaimer: `${AI_DISCLOSURE}Educational only. Not financial advice. Consult a licensed financial advisor.`,
      recommendedClips: {
        talking_head: "hedra-character-3",
        broll: "atlas-seedance-2.0",
        product_shot: "atlas-seedance-2.0",
      },
      compatiblePersonas: [], // orthogonal — any persona can run any template; the visual identity is the persona, the content format is the template
      defaultHashtagPack: [
        "#moneytips",
        "#financialliteracy",
        "#moneymindset",
        "#personalfinance",
        "#budgeting101",
      ],
      complianceCheckPrompt: `${COMPLIANCE_CHECK_BASE}
- REJECT if the script names specific stocks, ETFs, or crypto with a recommendation
- REJECT if it uses words like "guaranteed," "no-brainer," "you should buy"
- REJECT if it claims specific returns ("you'll make $X")
- PASS for: budgeting tips, mindset reframes, generic education on credit/saving/investing concepts`,
    },
  },

  // ============================================================
  // 2. TECH / SAAS / AI — high CPM, low compliance risk
  // ============================================================
  {
    niche: "tech",
    name: "AI Tool Tip — Quick Win",
    description:
      "30-second tool review or AI workflow shortcut. Fact-based, no compliance overhead.",
    stylePreset: "modern_clean",
    durationSeconds: 20,
    aspectRatio: "9:16",
    defaultMusicMood: "modern_synth",
    defaultVideoProvider: "atlas_seedance",
    promptScaffold: `Hook (1.5s): "I replaced {OLD_WORKFLOW} with {AI_TOOL} and..."
Beat 2 (3s): Show the OLD way (screen capture or visual metaphor).
Beat 3 (4s): Show the NEW way using the tool.
Beat 4 (4s): Time/cost saved (concrete number).
Payoff (4s): Tool name + one-line takeaway.

Include screen recordings or B-roll of the tool's UI when possible.`,
    metadata: {
      hookPatterns: [
        "I replaced [X] with [AI tool] and saved 5 hours/week",
        "POV: you finally found the AI tool that actually works",
        "Stop using [popular tool] — try this instead",
      ],
      sceneCount: 5,
      targetCutDurationSeconds: 2.0,
      bannedWords: [],
      requiredDisclaimer: `${AI_DISCLOSURE}#ad if sponsored.`,
      recommendedClips: {
        talking_head: "hedra-character-3",
        broll: "kling-3.0-pro",
        product_shot: "kling-3.0-pro",
      },
      compatiblePersonas: [], // orthogonal — any persona can run any template
      defaultHashtagPack: [
        "#aitools",
        "#productivityhacks",
        "#techtips",
        "#workflowautomation",
      ],
      complianceCheckPrompt: null, // no special compliance needs
    },
  },

  // ============================================================
  // 3. LEGAL / INSURANCE — high CPM, high compliance risk
  // ============================================================
  {
    niche: "legal",
    name: "Legal Explainer — General Education",
    description:
      "Plain-English explainers of legal concepts. Never specific case advice.",
    stylePreset: "explainer_clean",
    durationSeconds: 20,
    aspectRatio: "9:16",
    defaultMusicMood: "neutral_professional",
    defaultVideoProvider: "atlas_seedance",
    promptScaffold: `Hook (1.5s): "What {PROFESSION} doesn't want you to know about {TOPIC}"
Beat 2 (4s): Define the concept in plain English.
Beat 3 (4s): Show an example scenario (generic, not specific).
Beat 4 (4s): Practical takeaway for the viewer (educational only).
Payoff (4s): "Consult a lawyer for your specific situation" + save CTA.

NEVER: give legal advice for specific cases, recommend specific legal actions, name specific firms.`,
    metadata: {
      hookPatterns: [
        "What employers don't want you to know about non-competes",
        "Renters insurance 101 in 30 seconds",
        "POV: you finally understand what an LLC actually does",
      ],
      sceneCount: 5,
      targetCutDurationSeconds: 2.0,
      bannedWords: [
        "you should sue",
        "definitely file",
        "I recommend",
        "you have a case",
        "guaranteed to win",
      ],
      requiredDisclaimer: `${AI_DISCLOSURE}Educational only. Not legal advice. Consult a licensed attorney for your specific situation.`,
      recommendedClips: {
        talking_head: "hedra-character-3",
        broll: "atlas-seedance-2.0",
        product_shot: "atlas-seedance-2.0",
      },
      compatiblePersonas: [], // orthogonal — any persona can run any template
      defaultHashtagPack: [
        "#legaltips",
        "#knowyourrights",
        "#legaleducation",
        "#smallbusinesstips",
      ],
      complianceCheckPrompt: `${COMPLIANCE_CHECK_BASE}
- REJECT if the script gives advice for a specific case/situation
- REJECT if it tells the viewer "you should sue" or "you have a case"
- REJECT if it recommends specific lawyers or firms
- PASS for: explaining what laws/contracts mean, general consumer-rights education, "what to know before X"`,
    },
  },

  // ============================================================
  // 4. MEDICAL / HEALTH — moderate-high CPM, very high risk
  // ============================================================
  {
    niche: "medical",
    name: "Wellness Habit — Lifestyle (Not Clinical)",
    description:
      "Morning/evening routines, habit stacks, general wellness. Never diagnostic, never clinical claims.",
    stylePreset: "soft_natural",
    durationSeconds: 20,
    aspectRatio: "9:16",
    defaultMusicMood: "calm_ambient",
    defaultVideoProvider: "atlas_seedance",
    promptScaffold: `Hook (1.5s): "{HABIT} that doctors actually do" — frame as observational, not prescriptive.
Beat 2 (4s): What the habit is, simply.
Beat 3 (4s): How the persona does it (lifestyle moment).
Beat 4 (4s): Why it might help (general wellness reasoning, no clinical claims).
Payoff (4s): "Consult your doctor before starting any new routine" + save CTA.

NEVER: diagnose conditions, recommend medications, claim cures, prescribe doses.`,
    metadata: {
      hookPatterns: [
        "5 morning habits doctors actually recommend",
        "What I do every morning that my doctor liked",
        "POV: you finally figured out a simple wellness routine",
      ],
      sceneCount: 5,
      targetCutDurationSeconds: 2.0,
      bannedWords: [
        "cure",
        "treat",
        "diagnose",
        "prescribe",
        "dose",
        "this will heal",
        "guaranteed to help",
        "doctors hate this",
      ],
      requiredDisclaimer: `${AI_DISCLOSURE}Educational only. Not medical advice. Consult your doctor before changing diet, supplements, or routine.`,
      recommendedClips: {
        talking_head: "hedra-character-3",
        broll: "atlas-seedance-2.0",
        product_shot: "atlas-seedance-2.0",
      },
      compatiblePersonas: [], // orthogonal — any persona can run any template
      defaultHashtagPack: [
        "#wellnessroutine",
        "#morningroutine",
        "#healthyhabits",
        "#selfcaresunday",
        "#mindbodybalance",
      ],
      complianceCheckPrompt: `${COMPLIANCE_CHECK_BASE}
- REJECT if the script diagnoses any condition
- REJECT if it recommends specific medications, doses, or supplements with health claims
- REJECT if it claims to cure/treat/heal anything
- REJECT phrasing like "doctors hate this trick"
- PASS for: general wellness habits, recipes, lifestyle moments, sleep/hydration/movement tips`,
    },
  },

  // ============================================================
  // 5. B2B / MARKETING — high CPM, moderate risk
  // ============================================================
  {
    niche: "b2b",
    name: "Marketing Tactic — Case Study Style",
    description:
      "Concrete tactic + measurable outcome. Always cite the source so claims are defensible.",
    stylePreset: "professional_clean",
    durationSeconds: 22,
    aspectRatio: "9:16",
    defaultMusicMood: "modern_upbeat",
    defaultVideoProvider: "atlas_seedance",
    promptScaffold: `Hook (1.5s): "How I {MULTIPLIED_METRIC} in {TIMEFRAME}"
Beat 2 (4s): The metric and the starting baseline.
Beat 3 (5s): The exact tactic used (3 steps max).
Beat 4 (5s): The outcome with sourceable numbers.
Payoff (4s): One-line takeaway + save CTA.

Cite the source/case study in the on-screen text. No proprietary client info.`,
    metadata: {
      hookPatterns: [
        "How I 10x'd email open rates in 30 days",
        "The cold-DM script that booked 47 meetings",
        "Stop A/B testing this — test that instead",
      ],
      sceneCount: 5,
      targetCutDurationSeconds: 2.2,
      bannedWords: [
        "guaranteed",
        "secret formula",
        "this always works",
      ],
      requiredDisclaimer: `${AI_DISCLOSURE}Results vary. Source citations in description.`,
      recommendedClips: {
        talking_head: "hedra-character-3",
        broll: "kling-3.0-pro",
        product_shot: "atlas-seedance-2.0",
      },
      compatiblePersonas: [], // orthogonal — any persona can run any template
      defaultHashtagPack: [
        "#marketingtips",
        "#growthhacking",
        "#b2bmarketing",
        "#contentmarketing",
      ],
      complianceCheckPrompt: null,
    },
  },

  // ============================================================
  // 6. REAL ESTATE — moderate CPM, moderate risk
  // ============================================================
  {
    niche: "real_estate",
    name: "Market Trend — Lifestyle Observation",
    description:
      "Market trends, lifestyle, neighborhood vibes. Never transaction advice.",
    stylePreset: "aspirational_clean",
    durationSeconds: 20,
    aspectRatio: "9:16",
    defaultMusicMood: "luxury_ambient",
    defaultVideoProvider: "atlas_seedance",
    promptScaffold: `Hook (1.5s): "House prices in {CITY} are about to {TREND}"
Beat 2 (4s): The trend with source (Zillow/Redfin/etc).
Beat 3 (4s): What's driving it (one factor, simply explained).
Beat 4 (4s): What it means for renters vs buyers (general, not specific).
Payoff (4s): "Talk to a local agent for your situation" + save CTA.

NEVER: recommend buying/selling in a specific market, name specific properties, predict exact prices.`,
    metadata: {
      hookPatterns: [
        "House prices in [city] are about to [trend]",
        "POV: you finally understand why rent is so high",
        "What [city]'s housing market is doing in 30 seconds",
      ],
      sceneCount: 5,
      targetCutDurationSeconds: 2.0,
      bannedWords: [
        "you should buy",
        "you should sell",
        "guaranteed appreciation",
        "this is the best market",
        "definitely invest here",
      ],
      requiredDisclaimer: `${AI_DISCLOSURE}Not real estate advice. Trends only. Consult a licensed realtor for transaction decisions.`,
      recommendedClips: {
        talking_head: "hedra-character-3",
        broll: "kling-3.0-pro",
        product_shot: "kling-3.0-pro",
      },
      compatiblePersonas: [], // orthogonal — any persona can run any template
      defaultHashtagPack: [
        "#realestatemarket",
        "#housingmarket",
        "#firsthomebuyer",
        "#realestatetips",
      ],
      complianceCheckPrompt: `${COMPLIANCE_CHECK_BASE}
- REJECT if the script tells viewers to buy/sell in any specific market
- REJECT if it predicts exact price moves
- REJECT if it recommends specific properties or developments
- PASS for: market trend reporting (with sources), explainers of mortgage/lease concepts, lifestyle observations`,
    },
  },

  // ============================================================
  // 7. BEAUTY / SKINCARE — moderate CPM, low risk (AI-friendly)
  // ============================================================
  {
    niche: "beauty",
    name: "GRWM Routine — Quick Walkthrough",
    description:
      "Get-ready-with-me, product reviews, skincare routines. AI-persona native.",
    stylePreset: "soft_cinematic",
    durationSeconds: 18,
    aspectRatio: "9:16",
    defaultMusicMood: "soft_pop",
    defaultVideoProvider: "atlas_seedance",
    promptScaffold: `Hook (1.5s): "POV: you finally figured out {SKIN_PROBLEM}" or "GRWM for {OCCASION}"
Beat 2 (4s): First product application, close-up.
Beat 3 (4s): Second product, lifestyle shot.
Beat 4 (4s): Final reveal, full face/look.
Payoff (4s): Product list in caption + save CTA.

#ad tag required if sponsored.`,
    metadata: {
      hookPatterns: [
        "POV: you finally figured out your skin",
        "GRWM for a first date",
        "I tried [trend] for 30 days — here's the result",
      ],
      sceneCount: 5,
      targetCutDurationSeconds: 2.0,
      bannedWords: [
        "cures acne",
        "removes wrinkles permanently",
        "guaranteed clear skin",
      ],
      requiredDisclaimer: `${AI_DISCLOSURE}#ad if sponsored. Individual results vary.`,
      recommendedClips: {
        talking_head: "atlas-seedance-2.0",
        broll: "atlas-seedance-2.0",
        product_shot: "atlas-seedance-2.0",
      },
      compatiblePersonas: [], // orthogonal — any persona can run any template
      defaultHashtagPack: [
        "#grwm",
        "#skincareroutine",
        "#beautytips",
        "#makeuptutorial",
        "#cleangirlbeauty",
      ],
      complianceCheckPrompt: null,
    },
  },

  // ============================================================
  // 8. AESTHETIC / FASHION — moderate CPM, low risk (AI sweet spot)
  // ============================================================
  {
    niche: "fashion",
    name: "Aesthetic OOTD — Brand-Forward",
    description:
      "Outfit-of-the-day, styling tips, aesthetic-defining looks. Perfect for visual AI personas.",
    stylePreset: "fashion_editorial",
    durationSeconds: 16,
    aspectRatio: "9:16",
    defaultMusicMood: "moody_atmospheric",
    defaultVideoProvider: "atlas_seedance",
    promptScaffold: `Hook (1.5s): "How to dress like {AESTHETIC}" or "{AESTHETIC} starter pack"
Beat 2 (3.5s): Full-body outfit reveal.
Beat 3 (3.5s): Detail shots (shoes, accessories, layering).
Beat 4 (3.5s): Lifestyle moment in the outfit.
Payoff (4s): Aesthetic name + brand list in caption.

Lean into the persona's visual identity.`,
    metadata: {
      hookPatterns: [
        "How to dress like a [aesthetic] girl",
        "POV: you've finally nailed your aesthetic",
        "[Aesthetic] starter pack 2026",
      ],
      sceneCount: 5,
      targetCutDurationSeconds: 1.8,
      bannedWords: [],
      requiredDisclaimer: `${AI_DISCLOSURE}#ad if sponsored.`,
      recommendedClips: {
        talking_head: "atlas-seedance-2.0",
        broll: "atlas-seedance-2.0",
        product_shot: "kling-3.0-pro",
      },
      compatiblePersonas: [], // orthogonal — any persona can run any template
      defaultHashtagPack: [
        "#ootd",
        "#fashioninspo",
        "#styletips",
        "#aestheticfashion",
        "#alternativefashion",
      ],
      complianceCheckPrompt: null,
    },
  },

  // ============================================================
  // 9. FITNESS / WELLNESS — moderate CPM, low risk (AI sweet spot)
  // ============================================================
  {
    niche: "fitness",
    name: "Workout/Habit Challenge — Day 1 Of",
    description:
      "Workout routines, habit stacks, '30 days of X' challenges. AI-persona compatible.",
    stylePreset: "active_natural",
    durationSeconds: 18,
    aspectRatio: "9:16",
    defaultMusicMood: "energetic_upbeat",
    defaultVideoProvider: "atlas_seedance",
    promptScaffold: `Hook (1.5s): "I tried {THING} for 30 days" or "Day 1 of {CHALLENGE}"
Beat 2 (4s): What the thing is + starting point.
Beat 3 (4s): The action/workout/habit in progress.
Beat 4 (4s): How the persona felt + early result.
Payoff (4s): "Follow for Day X" + save CTA.

NEVER make clinical claims about weight loss numbers or health outcomes.`,
    metadata: {
      hookPatterns: [
        "I tried Pilates every day for 30 days",
        "Day 1 of cold plunge challenge",
        "POV: you actually stuck to a wellness routine",
      ],
      sceneCount: 5,
      targetCutDurationSeconds: 2.0,
      bannedWords: [
        "lose [number] pounds",
        "guaranteed results",
        "cure",
        "treat",
        "diagnose",
      ],
      requiredDisclaimer: `${AI_DISCLOSURE}Individual results vary. Consult your doctor before new exercise routines.`,
      recommendedClips: {
        talking_head: "atlas-seedance-2.0",
        broll: "atlas-seedance-2.0",
        product_shot: "atlas-seedance-2.0",
      },
      compatiblePersonas: [], // orthogonal — any persona can run any template
      defaultHashtagPack: [
        "#fitnessjourney",
        "#wellness",
        "#30daychallenge",
        "#healthyhabits",
        "#dayinmylife",
      ],
      complianceCheckPrompt: `${COMPLIANCE_CHECK_BASE}
- REJECT if the script promises specific weight-loss numbers
- REJECT if it claims to cure/treat any condition
- REJECT if it recommends specific supplements with health claims
- PASS for: general routines, motivation, "day X of Y" challenges, food prep`,
    },
  },

  // ============================================================
  // 10. FOOD / RECIPES — lower CPM, low risk, high volume potential
  // ============================================================
  {
    niche: "food",
    name: "Recipe Walkthrough — Visual Hook",
    description:
      "ASMR cooking, recipe walkthroughs, visual food moments. The current Raven smoothie template.",
    stylePreset: "asmr_cinematic",
    durationSeconds: 16,
    aspectRatio: "9:16",
    defaultMusicMood: "ambient_satisfying",
    defaultVideoProvider: "atlas_seedance",
    promptScaffold: `Hook (1.5s): "Wait, this {DISH} literally {VISUAL_HOOK}" (e.g., glows, melts, transforms)
Beat 2 (4s): Ingredients laid out, dramatic close-up.
Beat 3 (4s): Combining/cooking action.
Beat 4 (4s): Final reveal in the glass/plate.
Payoff (4s): "Save this. You're welcome." + recipe in caption.

Visual hook is mandatory — must be a scroll-stop image (glowing ingredient, color change, satisfying motion).`,
    metadata: {
      hookPatterns: [
        "Wait, this smoothie literally GLOWS",
        "POV: you found the most aesthetic [dish]",
        "I made [trendy food] and it changed my mornings",
      ],
      sceneCount: 5,
      targetCutDurationSeconds: 1.8,
      bannedWords: [
        "cures",
        "this will heal you",
        "doctors recommend",
        "guaranteed weight loss",
      ],
      requiredDisclaimer: `${AI_DISCLOSURE}#ad if sponsored.`,
      recommendedClips: {
        talking_head: "atlas-seedance-2.0",
        broll: "atlas-seedance-2.0",
        product_shot: "kling-3.0-pro",
      },
      compatiblePersonas: [], // orthogonal — any persona can run any template
      defaultHashtagPack: [
        "#recipe",
        "#aestheticfood",
        "#foodtok",
        "#easyrecipes",
        "#healthyrecipes",
      ],
      complianceCheckPrompt: null,
    },
  },
];

/**
 * Idempotent seed function — upserts the 10 niche templates as global presets
 * (companyId = null). Safe to run multiple times; matches on (companyId, name).
 *
 * Usage:
 *   import { db } from "../client.js";
 *   import { seedReelTemplates } from "./reel-templates.js";
 *   await seedReelTemplates(db);
 */
export async function seedReelTemplates(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
) {
  // Naive upsert: delete existing global templates with matching names, then insert
  const { reelTemplates: tbl } = await import("../schema/reels.js");
  const { sql, eq, and, isNull } = await import("drizzle-orm");

  for (const tmpl of REEL_TEMPLATES) {
    await db
      .delete(tbl)
      .where(and(isNull(tbl.companyId), eq(tbl.name, tmpl.name)));
  }

  await db.insert(tbl).values(REEL_TEMPLATES);

  return { inserted: REEL_TEMPLATES.length };
}
