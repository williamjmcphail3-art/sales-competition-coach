// rubric.js — the Sales Competition judging rubric, single source of truth for the frontend.
//
// 29 sub-criteria across 6 categories, each scored 0–10 (290 points total).
// Derived from Sturk_Sales_Coach_Agent_Instructions.md.
//
// Fields per item:
//   key         unique id, used as the Realtime Database field and the AI response key
//   label       short human label shown next to the input
//   help        one-line description of what earns points (also given to the AI)
//   improve     blunt, actionable coaching tip shown in the Insights tab for weak areas
//   manualOnly  true  -> never AI-scored; left blank/0 with a "score manually" note
//               false -> sent to the AI for a 0–10 suggestion + justification
//   placeholder true  -> a stand-in criterion you must define (see README)
//
// The AI only ever scores items where manualOnly === false. Everything else is
// left for the judge to score by hand, because a transcript can't reveal it.

export const RUBRIC = [
  {
    category: "1. Introduction / Approach",
    maxPoints: 30,
    items: [
      {
        key: "intro_opening",
        label: "Professional opening",
        help: "Greeting, handshake/fist bump or verbal equivalent, business-card or intro exchange, politeness.",
        improve: "Open with a crisp, professional greeting and a confident self-introduction — don't waste the first 20 seconds on filler.",
        manualOnly: true,
        manualReason: "The handshake/greeting gesture is physical — judge it in person.",
      },
      {
        key: "intro_rapport",
        label: "Builds rapport",
        help: "Finds commonality, builds credibility, maintains eye contact and engagement.",
        improve: "Find one genuine point of common ground early and use the buyer's name; forced small talk reads as fake.",
        manualOnly: true,
        manualReason: "Rapport and eye contact are non-verbal — judge them in person.",
      },
      {
        key: "intro_prep",
        label: "Organized meeting prep",
        help: "States the purpose, presents an agenda, and asks for feedback on the agenda.",
        improve: "State the meeting's purpose, lay out a short agenda, and explicitly ask if it works before diving in.",
        manualOnly: false,
      },
    ],
  },
  {
    category: "2. Confirming & Uncovering Relevant Facts",
    maxPoints: 30,
    items: [
      {
        key: "facts_process",
        label: "Uncovers purchasing process",
        help: "Draws out timeline, constraints, approval process, and budget.",
        improve: "Directly ask about budget, timeline, and who signs off — deals die at the approval stage you never mapped.",
        manualOnly: false,
      },
      {
        key: "facts_current",
        label: "Facts about current practices",
        help: "Learns target markets, past purchases, current suppliers, and order frequency.",
        improve: "Pin down current suppliers, order frequency, and what they buy today — you can't displace a competitor you never named.",
        manualOnly: false,
      },
      {
        key: "facts_criteria",
        label: "Criteria for buying new products",
        help: "Uncovers the buyer's criteria for purchasing new products.",
        improve: "Ask what criteria they'll use to judge a new product before you pitch, so you can aim straight at it.",
        manualOnly: false,
      },
    ],
  },
  {
    category: "3. Identifying Needs & Opportunities",
    maxPoints: 40,
    items: [
      {
        key: "needs_uncover",
        label: "Uncovers buyer needs",
        help: "Engaging questions about customer strategy and industry/market pressures.",
        improve: "Ask fewer, sharper open questions about their real challenges instead of reciting features at them.",
        manualOnly: false,
      },
      {
        key: "needs_cost",
        label: "Opportunity / cost of not changing",
        help: "Raises awareness of opportunities to improve or the cost of not changing — the loss of standing still, the gains of changing, and possible solutions.",
        improve: "Put a number on the cost of doing nothing — without quantified pain, the buyer feels no urgency to change.",
        manualOnly: false,
      },
      {
        key: "needs_interest",
        label: "Sparks interest",
        help: "Sparks interest in hearing more — shows how the product/service addresses a problem or opportunity in an impactful way.",
        improve: "Tie the coming pitch to a specific problem you just uncovered; a generic 'let me tell you about us' kills interest.",
        manualOnly: false,
      },
      {
        key: "needs_summary",
        label: "Summarizes & transitions",
        help: "Refers to the agenda, summarizes needs/challenges and progress, and asks for feedback before moving into the presentation.",
        improve: "Summarize what you heard and get explicit agreement before transitioning — don't assume alignment and barrel ahead.",
        manualOnly: false,
      },
    ],
  },
  {
    category: "4. Product / Service Presentation",
    maxPoints: 60,
    items: [
      {
        key: "pres_organized",
        label: "Organized, non-scripted",
        help: "Delivers an organized, non-scripted presentation.",
        improve: "Follow a clear problem→solution structure and adapt to the buyer's cues; a canned monologue loses the room.",
        manualOnly: false,
      },
      {
        key: "pres_data",
        label: "Uses data to tell a story",
        help: "Uses objective data to tell a story — not just reporting numbers, but giving specific examples of why they're relevant to the customer.",
        improve: "Use one or two concrete numbers tied to THIS buyer, not generic stats dumped without context.",
        manualOnly: false,
      },
      {
        key: "pres_benefits",
        label: "Benefits tied to problem",
        help: "Presents benefits tied to the buyer's problem and the solution.",
        improve: "Translate every feature into a benefit for their specific problem — features on their own don't sell.",
        manualOnly: false,
      },
      {
        key: "pres_knowledge",
        label: "Product knowledge & ideas",
        help: "Engages the buyer with product knowledge and creative ideas.",
        improve: "Show real product depth and offer a creative use tied to their needs; surface-level knowledge shows fast.",
        manualOnly: false,
      },
      {
        key: "pres_persuade",
        label: "Persuasive reason to buy",
        help: "Summarizes and persuasively presents the reason to buy.",
        improve: "Close the pitch with a clear, summarized reason to buy — don't trail off and hope they connect the dots.",
        manualOnly: false,
      },
      {
        key: "pres_softclose",
        label: "Soft close",
        help: "Gauges interest in purchasing (soft close) using open-ended questions.",
        improve: "Test interest with an open-ended soft-close question before pushing for the order.",
        manualOnly: false,
      },
    ],
  },
  {
    category: "5. Soliciting Feedback & Closing",
    maxPoints: 70,
    items: [
      {
        key: "close_feedback",
        label: "Solicits objections",
        help: "Asks for feedback and solicits objections.",
        improve: "Actively invite objections instead of dodging them — unspoken doubts don't disappear, they just lose the sale.",
        manualOnly: false,
      },
      {
        key: "close_openq",
        label: "Open-ended question first",
        help: "Asks an open-ended question before answering an objection.",
        improve: "When you hit an objection, ask an open question to understand it before you start answering.",
        manualOnly: false,
      },
      {
        key: "close_answer",
        label: "Answers the objection",
        help: "Effectively answers the objection with relevant facts or product information.",
        improve: "Answer objections with specific facts or product info, not vague reassurance — 'trust me' is not an answer.",
        manualOnly: false,
      },
      {
        key: "close_confirm",
        label: "Confirms it's resolved",
        help: "Confirms the objection is no longer a concern by asking a question.",
        improve: "After handling an objection, ask whether it's resolved — don't assume you cleared it and move on.",
        manualOnly: false,
      },
      {
        key: "close_ask",
        label: "Asks for the business",
        help: "Directly asks for the business and suggests an order size.",
        improve: "Actually ask for the business and name a specific order size — hinting is not closing.",
        manualOnly: false,
      },
      {
        key: "close_price",
        label: "Knows price/discounting",
        help: "Is knowledgeable on price and discounting.",
        improve: "Know your pricing and discount logic cold; fumbling on price signals you're not ready to close.",
        manualOnly: false,
      },
      {
        key: "close_next",
        label: "Clear next steps",
        help: "Prepared to complete the transaction — clear next steps regardless of the customer's answer, and gains commitment for follow-up.",
        improve: "Leave with concrete next steps and a committed follow-up regardless of the answer — never end on a vague 'I'll be in touch.'",
        manualOnly: false,
      },
    ],
  },
  {
    category: "6. Sales Style",
    maxPoints: 60,
    items: [
      {
        key: "style_aids",
        label: "Visual / physical aids",
        help: "Uses engaging visual or physical aids.",
        improve: "Use a clean, purposeful visual or physical aid; cluttered or absent aids weaken an otherwise strong pitch.",
        manualOnly: true,
        manualReason: "Visual aids can't be seen in a transcript.",
      },
      {
        key: "style_questions",
        label: "Engages via questions",
        help: "Engages the buyer through questions.",
        improve: "Engage the buyer with questions throughout, not just at the start — a monologue disengages the room.",
        manualOnly: true,
        manualReason: "Scored as part of live delivery. Flip manualOnly to false in rubric.js if you'd rather the AI judge it from the transcript.",
      },
      {
        key: "style_verbal",
        label: "Verbal communication",
        help: "Proper grammar, minimal filler words/tics, not scripted.",
        improve: "Cut filler words and slang and rehearse until it's conversational, not a recited script.",
        manualOnly: true,
        manualReason: "Delivery and tone are judged from the live pitch, not the text.",
      },
      {
        key: "style_nonverbal",
        label: "Non-verbal communication",
        help: "No distracting habits, good posture, strong camera presence.",
        improve: "Fix posture, eye contact, and nervous habits; the camera and the room read all of it.",
        manualOnly: true,
        manualReason: "Non-verbal — judge it in person.",
      },
      {
        key: "style_dress",
        label: "Professional dress / image",
        help: "Professional dress and image throughout; personal image doesn't distract from the presentation.",
        improve: "Dress a level above the room; a sloppy image undercuts your credibility before you say a word.",
        manualOnly: true,
        manualReason: "Appearance is visual — judge it in person.",
      },
      {
        key: "style_attitude",
        label: "Attitude & confidence",
        help: "Exhibits enthusiasm through smiling, body language, voice tone, and pace; confident in tone and behavior.",
        improve: "Bring visible energy and confidence — flat delivery makes even strong content forgettable.",
        manualOnly: true,
        manualReason: "Enthusiasm, tone, and body language are non-verbal — judge them in person.",
      },
    ],
  },
];

// Flat list of every item, in display order.
export const ALL_ITEMS = RUBRIC.flatMap((c) =>
  c.items.map((it) => ({ ...it, category: c.category })),
);

// The subset the AI is allowed to score (manualOnly === false).
export const AI_ITEMS = ALL_ITEMS.filter((it) => !it.manualOnly);

// Maximum total across all 29 items (10 each).
export const MAX_TOTAL = ALL_ITEMS.length * 10;
