import { LEGAL_DOC_KEYS } from "./legalRegistry";

const LAST_UPDATED = "March 12, 2026";

const DEFAULT_CONTENT = {
  lastUpdated: LAST_UPDATED,
  summary:
    "This policy is provided for informational and legal clarity. Final signed versions may include additional business-specific terms.",
  sections: [
    {
      title: "Scope",
      paragraphs: [
        "This document explains the core obligations and rules that apply when using MAJUU services.",
      ],
    },
  ],
};

export const LEGAL_DOCUMENT_CONTENT = {
  [LEGAL_DOC_KEYS.TERMS_AND_CONDITIONS]: {
    lastUpdated: LAST_UPDATED,
    summary: "These terms govern account use, service access, and platform conduct across MAJUU.",
    sections: [
      {
        title: "Eligibility and Account Use",
        paragraphs: [
          "Users must provide accurate account details and keep login credentials secure.",
          "MAJUU may suspend access for misuse, fraud, or repeated policy violations.",
        ],
      },
      {
        title: "Service Requests and Payments",
        paragraphs: [
          "Service pricing, payment milestones, and deliverable expectations are shown in the relevant request flow before payment.",
          "Escrow and refund outcomes are governed by the Escrow Policy and Refund Policy.",
        ],
      },
      {
        title: "Platform Integrity",
        paragraphs: [
          "Users must not bypass MAJUU workflows to avoid documented platform obligations.",
          "Where staff or service-partner relationships apply, non-circumvention obligations are enforced through role-specific agreements.",
        ],
      },
      {
        title: "Updates to Terms",
        paragraphs: [
          "MAJUU may update these terms to reflect legal, operational, or product changes.",
          "Continued use after updates means acceptance of the latest posted version.",
        ],
      },
    ],
  },

  [LEGAL_DOC_KEYS.PRIVACY_POLICY]: {
    lastUpdated: LAST_UPDATED,
    summary: "This policy explains how MAJUU collects, uses, stores, and protects personal data.",
    sections: [
      {
        title: "Data We Collect",
        paragraphs: [
          "MAJUU may collect profile data, request details, support messages, payment references, and service history.",
          "Only the minimum data needed to deliver and secure the service should be collected.",
        ],
      },
      {
        title: "How Data Is Used",
        paragraphs: [
          "Data is used to process requests, coordinate staff support, provide updates, and improve platform reliability.",
          "Data is also used for fraud prevention, dispute handling, and legal compliance where required.",
        ],
      },
      {
        title: "Data Sharing and Retention",
        paragraphs: [
          "Data is shared only with authorized platform personnel and approved processors who support service delivery.",
          "Retention timelines follow operational necessity and legal obligations, after which data is archived or removed.",
        ],
      },
      {
        title: "User Rights",
        paragraphs: [
          "Users may request profile corrections and raise privacy concerns through official MAJUU support channels.",
          "MAJUU will review and respond to privacy requests in line with applicable law and internal policy timelines.",
        ],
      },
    ],
  },

  [LEGAL_DOC_KEYS.ACCEPTABLE_USE_POLICY]: {
    lastUpdated: LAST_UPDATED,
    summary: "This policy defines prohibited behavior and acceptable conduct on MAJUU.",
    sections: [
      {
        title: "Prohibited Conduct",
        paragraphs: [
          "Users must not submit fraudulent information, abusive content, or illegal requests.",
          "Attempts to disrupt platform services, bypass controls, or impersonate other parties are prohibited.",
        ],
      },
      {
        title: "Communication Standards",
        paragraphs: [
          "All communication with staff, admins, and users must remain professional and lawful.",
          "Harassment, threats, and discriminatory language are grounds for immediate action.",
        ],
      },
      {
        title: "Enforcement",
        paragraphs: [
          "Policy violations may result in warnings, temporary restrictions, permanent suspension, or legal escalation.",
        ],
      },
    ],
  },

  [LEGAL_DOC_KEYS.REFUND_POLICY]: {
    lastUpdated: LAST_UPDATED,
    summary: "This policy explains when and how users can request refunds for MAJUU payments.",
    sections: [
      {
        title: "Refund Eligibility",
        paragraphs: [
          "Refund eligibility depends on payment type, service stage, and documented platform outcomes.",
          "Certain unlock payments may qualify for automated refunds under predefined conditions.",
        ],
      },
      {
        title: "Refund Requests",
        paragraphs: [
          "Users should submit refund requests from the relevant request payment section with a clear reason.",
          "Each request is reviewed against payment records and service evidence.",
        ],
      },
      {
        title: "Decisions and Timelines",
        paragraphs: [
          "Approved refunds are processed using the platform payment workflow and may take several business days.",
          "Rejected refunds include a reason so users can understand the decision.",
        ],
      },
    ],
  },

  [LEGAL_DOC_KEYS.DISPUTE_RESOLUTION_POLICY]: {
    lastUpdated: LAST_UPDATED,
    summary: "This policy outlines how MAJUU handles service disputes and contested outcomes.",
    sections: [
      {
        title: "Initial Resolution",
        paragraphs: [
          "Disputes should first be raised through platform support so evidence can be reviewed quickly.",
          "Both user and delivery-side records may be examined to determine a fair operational decision.",
        ],
      },
      {
        title: "Escalation",
        paragraphs: [
          "If initial review does not resolve the issue, the case may be escalated to senior operations review.",
          "Escalation decisions are documented and communicated through official channels.",
        ],
      },
      {
        title: "Policy Alignment",
        paragraphs: [
          "Dispute outcomes may involve payment status changes, refund decisions, or service corrections under applicable policies.",
        ],
      },
    ],
  },

  [LEGAL_DOC_KEYS.ESCROW_POLICY]: {
    lastUpdated: LAST_UPDATED,
    summary: "This policy explains how MAJUU handles controlled payment release and escrow-like safeguards.",
    sections: [
      {
        title: "Payment Holding and Release",
        paragraphs: [
          "Certain payment categories are held until required workflow milestones are satisfied.",
          "Release decisions rely on request status, approval checkpoints, and fraud controls.",
        ],
      },
      {
        title: "Auto-Refund Scenarios",
        paragraphs: [
          "Where configured, unattended unlock payments may become eligible for automatic refund after the defined window.",
          "Manual exceptions are reviewed by operations and finance controls.",
        ],
      },
      {
        title: "Transparency",
        paragraphs: [
          "Payment records, references, and status transitions are surfaced in request-linked payment views.",
        ],
      },
    ],
  },

  [LEGAL_DOC_KEYS.STAFF_AGREEMENT]: {
    lastUpdated: LAST_UPDATED,
    summary: "This agreement governs staff conduct, confidentiality, and performance obligations on MAJUU.",
    sections: [
      {
        title: "Role and Conduct",
        paragraphs: [
          "Staff must follow assignment instructions, quality standards, and response timelines defined by MAJUU operations.",
          "Misrepresentation, undocumented side promises, or off-platform diversion of work is prohibited.",
        ],
      },
      {
        title: "Confidentiality",
        paragraphs: [
          "Staff must keep all user data and request information confidential and use it only for assigned work.",
          "Unauthorized sharing, copying, or storage of sensitive content is a material violation.",
        ],
      },
      {
        title: "Non Circumvention Clause",
        paragraphs: [
          "Staff must not solicit or accept direct payment, direct engagements, or side arrangements with MAJUU users outside official platform channels.",
          "Any attempt to bypass MAJUU transaction controls or relationship ownership is treated as non-circumvention breach and may trigger immediate suspension and legal action.",
        ],
      },
      {
        title: "Breach and Remedies",
        paragraphs: [
          "MAJUU may revoke access, withhold pending payouts under review, and pursue contractual remedies for material breaches.",
        ],
      },
    ],
  },

  [LEGAL_DOC_KEYS.SERVICE_PARTNER_AGREEMENT]: {
    lastUpdated: LAST_UPDATED,
    summary: "This agreement governs service partner delivery, quality, and payment obligations.",
    sections: [
      {
        title: "Service Standards",
        paragraphs: [
          "Service partners must deliver according to agreed timelines, documented scope, and quality expectations.",
          "Partners are responsible for lawful operations and accurate representations of service capability.",
        ],
      },
      {
        title: "Payment and Settlement",
        paragraphs: [
          "Payments are released according to approved service milestones and platform controls.",
          "Chargebacks, disputes, and refunds are handled under MAJUU payment and dispute policies.",
        ],
      },
      {
        title: "Non Circumvention Clause",
        paragraphs: [
          "Service partners must not bypass MAJUU to transact directly with MAJUU users introduced through the platform.",
          "Direct side arrangements intended to avoid platform controls, fees, or oversight are prohibited and may result in immediate termination and legal remedies.",
        ],
      },
      {
        title: "Termination",
        paragraphs: [
          "MAJUU may suspend or terminate partner access for policy violations, repeated quality failures, or contractual non-compliance.",
        ],
      },
    ],
  },

  [LEGAL_DOC_KEYS.STAFF_TIER_SYSTEM]: {
    lastUpdated: LAST_UPDATED,
    summary: "This policy explains how staff performance tiers are assigned and adjusted.",
    sections: [
      {
        title: "Tier Levels",
        paragraphs: [
          "Current staff tiers are Provisional, Silver, Gold, and Diamond.",
          "Tier level reflects quality consistency, review outcomes, and operational reliability.",
        ],
      },
      {
        title: "Evaluation Factors",
        paragraphs: [
          "Tier movement considers acceptance rate, turnaround time, policy compliance, and quality review signals.",
          "Repeated quality issues or policy breaches may reduce tier status or pause access.",
        ],
      },
      {
        title: "Rehire and Reset",
        paragraphs: [
          "Revoke and rehire cycles may reset tier standing based on MAJUU staff governance rules.",
        ],
      },
    ],
  },

  [LEGAL_DOC_KEYS.STAFF_PAYMENT_POLICY]: {
    lastUpdated: LAST_UPDATED,
    summary: "This policy explains how staff payouts are approved, tracked, and released.",
    sections: [
      {
        title: "Payout Eligibility",
        paragraphs: [
          "Payout applies to completed tasks that pass review and are approved through official MAJUU channels.",
          "Rejected, abandoned, or policy-breaching submissions are not payable.",
        ],
      },
      {
        title: "Approval Flow",
        paragraphs: [
          "Staff payment proposals are reviewed by admin before user payment and settlement completion.",
          "Payment records and status updates remain linked to request-level history for auditability.",
        ],
      },
      {
        title: "Payment Integrity",
        paragraphs: [
          "Staff must never request direct payment from users outside MAJUU workflows.",
          "Violations are treated as serious misconduct and may trigger immediate access revocation.",
        ],
      },
    ],
  },
};

export function getLegalDocumentContent(docKey) {
  return LEGAL_DOCUMENT_CONTENT[docKey] || DEFAULT_CONTENT;
}
