"""The demo's two contracts. Every party, person and address is fictional.

Markup: **bold**, [-deleted-], {+inserted+}; "[--...-]" deletes a whole paragraph.
Block kinds: title, p (paragraph), h (section heading), c (numbered clause,
"1.1<TAB>text"), i (item, "(a)<TAB>text"), sig (signature line), gap, annex
(a heading that starts a new page).
"""

RP = "[-Recipient-]{+the Receiving Party+}"      # "Recipient" mid-sentence
RP_ = "[-Recipient-]{+The Receiving Party+}"     # at the start of a sentence
DP = "[-Acme-]{+the Disclosing Party+}"

NDA = {
    "author": "MikeGC",
    "date": "2026-11-09T10:15:00Z",
    "footer": "Acme, Inc. Non-Disclosure Agreement (Form NDA-1W, rev. 2026-03)",
    "blocks": [
        ("title", "{+MUTUAL +}NON-DISCLOSURE AGREEMENT"),
        ("p", 'This {+Mutual +}Non-Disclosure Agreement (the "**Agreement**") is entered into as of November 9, 2026 (the "**Effective Date**") '
              'by and between Acme, Inc., a Delaware corporation with its principal place of business in Chicago, Illinois ("**Acme**"), and '
              'Alia, Inc., a Delaware corporation with its principal place of business in San Francisco, California ("[-**Recipient**-]{+**Alia**+}").'
              '{+ Acme and Alia are each referred to as a "Party" and together as the "Parties".+}'),
        ("p", "[-Acme wishes to disclose certain Confidential Information to Recipient-]{+The Parties wish to disclose certain Confidential Information to each other+} "
              "for the purpose of evaluating a potential commercial relationship under which Alia would provide its AI model and agent platform "
              'to Acme (the "**Purpose**"). In consideration of the disclosures made under this Agreement, the Parties agree as follows:'),

        ("h", "1.  DEFINITIONS"),
        ("c", '1.1\t"**Affiliate**" means any entity that directly or indirectly controls, is controlled by, or is under common control with a Party, '
              'where "control" means ownership of more than fifty percent (50%) of the voting interests of the entity.'),
        ("c", '1.2\t"**Confidential Information**" means all non-public information disclosed by [-Acme or its Affiliates-]{+a Party or its Affiliates '
              '(the "Disclosing Party")+} to [-Recipient-]{+the other Party (the "Receiving Party")+}, whether before or after the Effective Date and '
              "whether in writing, orally, electronically or by inspection, that is marked or identified as confidential or that a reasonable person "
              "would understand to be confidential given the nature of the information and the circumstances of disclosure. Confidential Information "
              "includes product plans and roadmaps, source code, model weights, training and evaluation data, prompts, system architecture, security "
              "information, pricing, customer and supplier information, and business and marketing plans."),
        ("c", '1.3\t"**Representatives**" means a Party\'s Affiliates and its and their directors, officers, employees, contractors and professional '
              "advisers who need to know the Confidential Information for the Purpose and who are bound by written or professional obligations of "
              "confidentiality no less protective than those in this Agreement."),

        ("h", "2.  CONFIDENTIALITY OBLIGATIONS"),
        ("c", f"2.1\t{RP_} shall:"),
        ("i", "(a)\tuse the Confidential Information solely for the Purpose;"),
        ("i", "(b)\tnot disclose the Confidential Information to any person other than its Representatives, and then only to the extent necessary for the Purpose;"),
        ("i", "(c)\tprotect the Confidential Information using at least the degree of care it uses to protect its own confidential information of a "
              "similar nature, and in no event less than reasonable care;"),
        ("i", "(d)\tnot reverse engineer, decompile or disassemble any software, models or prototypes provided as Confidential Information, and not "
              "use any Confidential Information to train, fine-tune or evaluate any machine learning model; and"),
        ("i", f"(e)\tpromptly notify {DP} in writing on becoming aware of any unauthorized use or disclosure of the Confidential Information."),
        ("c", f"2.2\t{RP_} is responsible for any act or omission of its Representatives that would breach this Agreement if committed by {RP}."),

        ("h", "3.  EXCLUSIONS"),
        ("c", f"3.1\tThe obligations in Section 2 do not apply to information that {RP} can demonstrate by written records:"),
        ("i", f"(a)\tis or becomes generally available to the public other than through a breach of this Agreement by {RP} or its Representatives;"),
        ("i", f"(b)\twas lawfully known to {RP} without restriction before receipt from {DP};"),
        ("i", f"(c)\tis lawfully received by {RP} from a third party without restriction and without breach of any obligation owed to {DP}; or"),
        ("i", f"(d)\tis independently developed by {RP} without use of or reference to the Confidential Information."),

        ("h", "4.  COMPELLED DISCLOSURE"),
        ("c", f"4.1\tIf {RP} is required by law, regulation or order of a court or governmental authority to disclose any Confidential Information, "
              f"it may do so provided that, to the extent legally permitted, it gives {DP} prompt written notice, cooperates with any effort by {DP} "
              "to seek a protective order, and discloses only the portion of the Confidential Information that it is legally required to disclose."),

        ("h", "5.  RETURN AND DESTRUCTION"),
        ("c", f"5.1\tWithin thirty (30) days after [-Acme's-]{{+the Disclosing Party's+}} written request, {RP} shall return or destroy all Confidential "
              f"Information in its possession or control and, on request, certify the destruction in writing. {RP_} may retain copies held in "
              "automatic electronic backups or as required by law or its bona fide document retention policies, provided that such copies remain "
              "subject to this Agreement for as long as they are retained."),

        ("h", "6.  [-RESIDUALS-]{+[INTENTIONALLY OMITTED]+}"),
        ("c", "[--6.1\tNothing in this Agreement restricts Acme from using, for any purpose, any information retained in the unaided memory of its "
              "personnel as a result of discussions with Recipient, including ideas, concepts, know-how and techniques, provided that such personnel "
              "do not intentionally memorize the information for the purpose of retaining it.-]"),

        ("h", "7.  NO LICENSE; NO WARRANTY"),
        ("c", f"7.1\tAll Confidential Information remains the property of {DP}. No license or other right in any Confidential Information, patent, "
              "copyright, trade secret or other intellectual property right is granted under this Agreement, except the limited right to use "
              "Confidential Information for the Purpose."),
        ("c", '7.2\tALL CONFIDENTIAL INFORMATION IS PROVIDED "AS IS". [-ACME MAKES NO-]{+NEITHER PARTY MAKES ANY+} WARRANTY, EXPRESS OR IMPLIED, '
              "AS TO THE ACCURACY OR COMPLETENESS OF ANY CONFIDENTIAL INFORMATION."),

        ("h", "8.  TERM"),
        ("c", "8.1\tThis Agreement applies to Confidential Information disclosed during the period of one (1) year from the Effective Date. Either "
              "Party may terminate this Agreement earlier on thirty (30) days' written notice to the other."),
        ("c", "8.2\t[-Recipient's-]{+The Receiving Party's+} obligations under this Agreement continue for [-seven (7)-]{+three (3)+} years from "
              "the date of the last disclosure of Confidential Information, except that obligations with respect to any trade secret continue for "
              "so long as the information remains a trade secret under applicable law."),

        ("h", "9.  REMEDIES"),
        ("c", f"9.1\t[-Recipient-]{{+Each Party+}} acknowledges that any unauthorized use or disclosure of Confidential Information may cause "
              f"irreparable harm to {DP} for which damages would not be an adequate remedy. [-Acme-]{{+The Disclosing Party+}} shall therefore be "
              "entitled to seek injunctive or other equitable relief, without the need to post a bond, in addition to any other remedies available "
              "at law or in equity."),

        ("h", "10.  NO OBLIGATION"),
        ("c", "10.1\tNothing in this Agreement obliges either Party to disclose any particular information, to enter into any further agreement or "
              "to proceed with any transaction. Each Party remains free to pursue discussions with third parties, provided it does not use or "
              "disclose [-Acme's-]{+the other Party's+} Confidential Information in breach of this Agreement."),

        ("h", "11.  EXPORT CONTROL"),
        ("c", "11.1\tEach Party shall comply with all applicable export control and sanctions laws in connection with any Confidential Information "
              "it receives under this Agreement."),

        ("h", "12.  GOVERNING LAW AND JURISDICTION"),
        ("c", "12.1\tThis Agreement is governed by the laws of the State of Delaware, without regard to its conflict of laws principles. The state "
              "and federal courts located in the State of Delaware have exclusive jurisdiction over any dispute arising out of or relating to this "
              "Agreement, and each Party submits to the personal jurisdiction of those courts."),

        ("h", "13.  GENERAL"),
        ("c", "13.1\t**Entire agreement.** This Agreement is the entire agreement between the Parties about its subject matter and supersedes all "
              "prior agreements and understandings, whether written or oral, relating to that subject matter."),
        ("c", "13.2\t**Amendment and waiver.** No amendment to this Agreement is effective unless it is in writing and signed by both Parties. No "
              "failure or delay in exercising any right operates as a waiver of it."),
        ("c", "13.3\t**Assignment.** [-Recipient may not-]{+Neither Party may+} assign this Agreement without the prior written consent of "
              "[-Acme-]{+the other Party+}, except to a successor in connection with a merger, acquisition or sale of all or substantially all of "
              "its assets or business to which this Agreement relates."),
        ("c", "13.4\t**Severability.** If any provision of this Agreement is held unenforceable, it shall be enforced to the maximum extent "
              "permissible and the remaining provisions shall remain in full force and effect."),
        ("c", "13.5\t**Notices.** Notices under this Agreement must be in writing and delivered by hand, by courier or by email to the address "
              "set out below each Party's signature, or to any other address a Party notifies to the other."),
        ("c", "13.6\t**Counterparts.** This Agreement may be executed in counterparts, including by electronic signature, each of which is an "
              "original and all of which together are one instrument."),

        ("p", "IN WITNESS WHEREOF, the Parties have executed this Agreement as of the Effective Date."),
        ("sig", "**ACME, INC.**"),
        ("sig", "By: ____________________________________"),
        ("sig", "Name:"), ("sig", "Title:"), ("sig", "Date:"), ("sig", "Notices: legal@acme.example"),
        ("gap",),
        ("sig", "**ALIA, INC.**"),
        ("sig", "By: ____________________________________"),
        ("sig", "Name:"), ("sig", "Title:"), ("sig", "Date:"), ("sig", "Notices: legal@alia.ai"),
    ],
}

DPA = {
    "author": "Priya Shah",
    "date": "2026-11-09T10:19:40Z",
    "footer": "Brightwater Data Processing Addendum (v4.2)",
    "blocks": [
        ("title", "DATA PROCESSING ADDENDUM"),
        ("p", 'This Data Processing Addendum (the "**Addendum**") is entered into as of November 9, 2026 between Alia, Inc., a Delaware corporation '
              '("**Customer**"), and Brightwater Data Ltd, a company registered in England and Wales ("**Brightwater**"). It forms part of the Master '
              'Subscription Agreement between them dated November 9, 2026 (the "**Agreement**"), under which Brightwater provides its product '
              'analytics services to Customer (the "**Services**").'),

        ("h", "1.  DEFINITIONS AND INTERPRETATION"),
        ("c", "1.1\tCapitalized terms not defined in this Addendum have the meanings given in the Agreement. In this Addendum:"),
        ("i", '(a)\t"**Customer Personal Data**" means any Personal Data processed by Brightwater on behalf of Customer in connection with the Services;'),
        ("i", '(b)\t"**Data Protection Laws**" means all laws relating to data protection and privacy that apply to the processing of Customer '
              "Personal Data, including the GDPR, the UK GDPR, the UK Data Protection Act 2018 and the California Consumer Privacy Act, each as "
              "amended or replaced from time to time;"),
        ("i", '(c)\t"**GDPR**" means Regulation (EU) 2016/679, and "**UK GDPR**" means the GDPR as it forms part of the law of the United Kingdom;'),
        ("i", '(d)\t"**Personal Data Breach**" means a breach of security leading to the accidental or unlawful destruction, loss, alteration, '
              "unauthorized disclosure of, or access to, Customer Personal Data;"),
        ("i", '(e)\t"**Standard Contractual Clauses**" means the standard contractual clauses approved by the European Commission in Implementing '
              'Decision (EU) 2021/914, and the "**UK Addendum**" means the International Data Transfer Addendum issued by the UK Information '
              "Commissioner; and"),
        ("i", '(f)\t"**Sub-processor**" means any third party engaged by Brightwater to process Customer Personal Data.'),
        ("c", '1.2\tThe terms "controller", "processor", "data subject", "personal data", "processing" and "supervisory authority" have the '
              "meanings given in the GDPR."),

        ("h", "2.  SCOPE AND ROLES"),
        ("c", "2.1\tCustomer is the controller and Brightwater is the processor of Customer Personal Data."),
        ("c", "2.2\tThe subject matter, duration, nature and purpose of the processing, and the types of Customer Personal Data and categories of "
              "data subjects, are set out in Annex 1."),
        ("c", "2.3\tEach party shall comply with the obligations that apply to it under Data Protection Laws."),

        ("h", "3.  PROCESSING INSTRUCTIONS"),
        ("c", "3.1\tBrightwater shall process Customer Personal Data only on Customer's documented instructions, including with regard to "
              "transfers, unless applicable law requires otherwise, in which case Brightwater shall inform Customer of that legal requirement "
              "before processing unless the law prohibits it. The Agreement and this Addendum are Customer's complete instructions at the date of "
              "this Addendum."),
        ("c", "3.2\tBrightwater shall immediately inform Customer if, in its opinion, an instruction infringes Data Protection Laws."),
        ("c", "3.3\tBrightwater shall not sell or share Customer Personal Data, retain, use or disclose it outside the direct business relationship "
              "between the parties, or combine it with personal data it receives from other sources, except as permitted by Data Protection Laws."),

        ("h", "4.  CONFIDENTIALITY"),
        ("c", "4.1\tBrightwater shall ensure that every person it authorizes to process Customer Personal Data is subject to a duty of confidentiality."),

        ("h", "5.  SECURITY"),
        ("c", "5.1\tBrightwater shall implement and maintain the technical and organizational measures set out in Annex 2 to ensure a level of "
              "security appropriate to the risk, taking into account the state of the art, the costs of implementation and the nature, scope, "
              "context and purposes of the processing."),
        ("c", "5.2\tBrightwater may update the measures in Annex 2 from time to time, provided that the updates do not materially reduce the "
              "overall level of security."),

        ("h", "6.  SUB-PROCESSORS"),
        ("c", "6.1\tCustomer authorizes Brightwater to engage the Sub-processors listed in Annex 3."),
        ("c", "6.2\tBrightwater may engage [-additional Sub-processors at its discretion-]{+an additional or replacement Sub-processor after "
              "giving Customer at least thirty (30) days' prior written notice, during which Customer may object on reasonable grounds relating to "
              "data protection. If Customer objects, the parties shall discuss its concerns in good faith and, if they cannot resolve them, "
              "Customer may terminate the affected Services without penalty+}."),
        ("c", "6.3\tBrightwater shall impose on each Sub-processor, by written contract, data protection obligations no less protective than those "
              "in this Addendum, and remains fully liable to Customer for the performance of each Sub-processor's obligations."),

        ("h", "7.  DATA SUBJECT RIGHTS"),
        ("c", "7.1\tTaking into account the nature of the processing, Brightwater shall assist Customer by appropriate technical and "
              "organizational measures, insofar as possible, in responding to requests from data subjects to exercise their rights under Data "
              "Protection Laws. Brightwater shall promptly forward to Customer any such request it receives and shall not respond to it except on "
              "Customer's instructions."),

        ("h", "8.  PERSONAL DATA BREACHES"),
        ("c", "8.1\tBrightwater shall notify Customer without undue delay{+, and in any event within forty-eight (48) hours,+} after becoming "
              "aware of a Personal Data Breach."),
        ("c", "8.2\tThe notice shall describe, to the extent known, the nature of the Personal Data Breach, the categories and approximate number "
              "of data subjects and records concerned, its likely consequences, and the measures taken or proposed to address it. Brightwater "
              "shall provide further information as it becomes available and take reasonable steps to contain and remedy the Personal Data Breach."),

        ("h", "9.  DATA PROTECTION IMPACT ASSESSMENTS"),
        ("c", "9.1\tBrightwater shall provide reasonable assistance to Customer with any data protection impact assessment, and any prior "
              "consultation with a supervisory authority, that Customer reasonably considers to be required in relation to the Services."),

        ("h", "10.  INTERNATIONAL TRANSFERS"),
        ("c", "10.1\tBrightwater shall not transfer Customer Personal Data outside the United Kingdom or the European Economic Area unless it has "
              "taken the measures required by Data Protection Laws to ensure that the transfer is lawful."),
        ("c", "10.2\tTo the extent that a transfer of Customer Personal Data between the parties is a restricted transfer, the Standard "
              "Contractual Clauses (Module Two: controller to processor) and, for transfers from the United Kingdom, the UK Addendum are "
              "incorporated into this Addendum, completed with the information in Annexes 1 and 2."),

        ("h", "11.  AUDITS"),
        ("c", "11.1\tBrightwater shall make available to Customer all information reasonably necessary to demonstrate compliance with this "
              "Addendum, including its most recent SOC 2 Type II report."),
        ("c", "11.2\tWhere that information is not sufficient to demonstrate compliance, Brightwater shall allow audits by Customer or an "
              "independent auditor it appoints, no more than once in any twelve (12) month period, on at least thirty (30) days' written notice, "
              "during normal business hours and subject to reasonable confidentiality obligations."),

        ("h", "12.  RETURN AND DELETION"),
        ("c", "12.1\tWithin thirty (30) days after the end of the Services, Brightwater shall, at Customer's choice, return or delete all Customer "
              "Personal Data and delete existing copies, unless applicable law requires it to retain them."),

        ("h", "13.  LIABILITY"),
        ("c", "13.1\t[-Each party's liability arising out of or in connection with this Addendum is subject to the limitations and exclusions of "
              "liability in the Agreement.-]{+Brightwater's aggregate liability arising out of or in connection with this Addendum shall not "
              "exceed two times (2x) the fees paid or payable by Customer under the Agreement in the twelve (12) months preceding the event giving "
              "rise to the claim. This limit is separate from, and in addition to, any limitation of liability in the Agreement.+}"),

        ("h", "14.  GENERAL"),
        ("c", "14.1\tIf there is a conflict between this Addendum and the Agreement, this Addendum prevails in relation to the processing of "
              "Customer Personal Data. If there is a conflict between this Addendum and the Standard Contractual Clauses, the Standard Contractual "
              "Clauses prevail."),
        ("c", "14.2\tThis Addendum terminates automatically when Brightwater ceases to process Customer Personal Data."),
        ("c", "14.3\tThis Addendum is governed by the law that governs the Agreement."),

        ("p", "Signed by the authorized representatives of the parties:"),
        ("sig", "**ALIA, INC.**"),
        ("sig", "By: ____________________________________"),
        ("sig", "Name:"), ("sig", "Title:"), ("sig", "Date:"),
        ("gap",),
        ("sig", "**BRIGHTWATER DATA LTD**"),
        ("sig", "By: ____________________________________"),
        ("sig", "Name:"), ("sig", "Title:"), ("sig", "Date:"),

        ("annex", "ANNEX 1: DETAILS OF PROCESSING"),
        ("p", "**Subject matter.** Brightwater's provision of the Services to Customer."),
        ("p", "**Duration.** The term of the Agreement, and the period until deletion under Section 12."),
        ("p", "**Nature and purpose.** Collection, storage, aggregation and analysis of product usage events from Customer's platform to provide "
              "dashboards, funnel and retention reports, and alerts to Customer."),
        ("p", "**Categories of data subjects.** Users of Customer's products and services; Customer's employees and contractors who use the Services."),
        ("p", "**Categories of personal data.** Account and user identifiers; names and business email addresses; IP addresses and approximate "
              "location derived from them; device, browser and operating system information; product usage events and timestamps."),
        ("p", "**Special categories of personal data.** None."),
        ("p", "**Frequency of transfer.** Continuous."),
        ("p", "**Retention.** Raw event data is retained for twenty-five (25) months and then deleted or irreversibly aggregated."),

        ("annex", "ANNEX 2: TECHNICAL AND ORGANIZATIONAL MEASURES"),
        ("i", "(a)\t**Encryption.** Customer Personal Data is encrypted in transit using TLS 1.2 or higher and at rest using AES-256."),
        ("i", "(b)\t**Access control.** Access is granted on a least-privilege basis through single sign-on with multi-factor authentication, "
              "and is reviewed quarterly."),
        ("i", "(c)\t**Logging and monitoring.** Access to production systems is logged; logs are retained for at least twelve (12) months and "
              "monitored for anomalous activity."),
        ("i", "(d)\t**Vulnerability management.** Systems are patched on a risk-based schedule, and an independent penetration test is performed "
              "at least annually."),
        ("i", "(e)\t**Resilience.** Data is backed up daily to a separate region, and recovery procedures are tested at least annually."),
        ("i", "(f)\t**Personnel.** Staff complete security and privacy training on joining and annually, and are bound by confidentiality obligations."),
        ("i", "(g)\t**Certification.** Brightwater maintains a SOC 2 Type II report covering the Services."),

        ("annex", "ANNEX 3: SUB-PROCESSORS"),
        ("p", "[To be provided by Brightwater.]"),
    ],
}

CONTRACTS = {"nda": NDA, "dpa": DPA}
