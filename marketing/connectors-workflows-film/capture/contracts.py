"""The film's contract: Harbor & Pine's draft Master Services Agreement for
renewing its data-labelling work for Alia. Every party, person and address is
fictional.

Markup (as in the intake film's contracts.py): **bold**, [-deleted-],
{+inserted+}. The tracked changes are the Contract Markup workflow's, signed
by Priya Shah, as the app signs an Assistant edit with the person who asked
for it. "msa-original" is the same draft with the changes stripped.
"""
import re

P = "Provider"
C = "Customer"

MSA = {
    "author": "Priya Shah",
    "date": "2026-11-09T10:21:00Z",
    "footer": "Harbor & Pine Data Services, LLC Master Services Agreement (HP-MSA rev. 2026-10) · Draft for discussion",
    "blocks": [
        ("title", "MASTER SERVICES AGREEMENT"),
        ("p", 'This Master Services Agreement (the "**Agreement**") is entered into as of December 1, 2026 (the "**Effective Date**") by and between '
              'Harbor & Pine Data Services, LLC, a California limited liability company with its principal place of business in Oakland, California '
              '("**Provider**"), and Alia, Inc., a Delaware corporation with its principal place of business in San Francisco, California ("**Customer**"). '
              'Provider and Customer are each referred to as a "**party**" and together as the "**parties**".'),
        ("p", "Provider provides data annotation, evaluation and quality assurance services for machine learning systems. Customer wishes to engage "
              "Provider to provide those services in support of its AI model and agent platform, and Provider wishes to provide them, on the terms of "
              "this Agreement. The parties therefore agree as follows:"),

        ("h", "1.  DEFINITIONS"),
        ("c", '1.1\t"**Affiliate**" means any entity that directly or indirectly controls, is controlled by, or is under common control with a party, '
              'where "control" means ownership of more than fifty percent (50%) of the voting interests of the entity.'),
        ("c", '1.2\t"**Customer Data**" means all data, prompts, model outputs, files and other materials that Customer or its Affiliates provide to '
              "Provider, or that Provider creates or collects for Customer, in connection with the Services, including any personal information they contain."),
        ("c", '1.3\t"**Deliverables**" means the labelled datasets, evaluation sets, rubrics, reports and other work product that Provider delivers to '
              "Customer under a Statement of Work."),
        ("c", '1.4\t"**Provider Materials**" means Provider\'s annotation platform, tooling, guidelines templates, know-how and other materials that '
              "Provider owns or licenses independently of this Agreement."),
        ("c", '1.5\t"**Services**" means the services described in Schedule 1 and in each Statement of Work.'),
        ("c", '1.6\t"**Statement of Work**" or "**SOW**" means a document executed by both parties that refers to this Agreement and describes '
              "specific Services, Deliverables, timelines and any additional fees."),

        ("h", "2.  SERVICES"),
        ("c", "2.1\tProvider shall provide the Services in accordance with this Agreement, each Statement of Work and the service levels in Schedule 2."),
        ("c", "2.2\tEach Statement of Work forms part of this Agreement. If a Statement of Work conflicts with this Agreement, this Agreement "
              "prevails unless the Statement of Work expressly states that it overrides a specific section of this Agreement."),
        ("c", "2.3\tProvider shall assign suitably skilled and trained personnel to the Services, shall ensure that each person who handles "
              "Customer Data has completed Provider's security and confidentiality training, and shall replace any person Customer reasonably "
              "objects to within ten (10) business days."),
        ("c", "2.4\tProvider may use subcontractors to perform the Services only with Customer's prior written consent, which Customer shall not "
              "unreasonably withhold. Provider remains responsible for the acts and omissions of its subcontractors as if they were its own."),
        ("c", "2.5\tEither party may request a change to a Statement of Work. No change takes effect until both parties sign a written change order "
              "describing its effect on scope, timelines and fees."),

        ("h", "3.  TERM AND RENEWAL"),
        ("c", '3.1\tThis Agreement begins on the Effective Date and continues for three (3) years (the "**Initial Term**").'),
        ("c", '3.2\tThis Agreement renews automatically for successive periods of twelve (12) months (each a "**Renewal Term**") unless either party '
              "gives the other at least [-ninety (90)-]{+thirty (30)+} days' written notice of non-renewal before the end of the then-current term."),
        ("c", "3.3\tEach Statement of Work continues until the Services under it are complete or it is terminated in accordance with Section 13. "
              "The expiry of this Agreement does not end a Statement of Work then in progress, which this Agreement continues to govern."),

        ("h", "4.  CUSTOMER RESPONSIBILITIES"),
        ("c", "4.1\tCustomer shall provide the Customer Data, labelling guidelines and access reasonably required for Provider to perform the Services, "
              "and shall respond to Provider's reasonable questions within the timelines set out in the applicable Statement of Work."),
        ("c", "4.2\tCustomer is responsible for having the rights and consents needed to provide the Customer Data to Provider for the Services."),

        ("h", "5.  SERVICE LEVELS"),
        ("c", "5.1\tProvider shall meet the turnaround, accuracy and support service levels in Schedule 2. Provider shall report its performance "
              "against them to Customer each month."),
        ("c", "5.2\tIf Provider fails to meet a service level, Provider shall credit Customer the amount set out in Schedule 2 against the next invoice. "
              "Service credits are Customer's sole monetary remedy for a service level failure, but do not limit Customer's right to terminate under Section 13."),

        ("h", "6.  FEES AND PAYMENT"),
        ("c", "6.1\tCustomer shall pay the fees set out in Schedule 3 and in each Statement of Work (the \"**Fees**\")."),
        ("c", "6.2\tProvider shall invoice the Fees monthly in arrears. Customer shall pay each undisputed invoice within thirty (30) days of receipt. "
              "Customer shall notify Provider in writing of any disputed amount, with reasons, before its due date, and the parties shall work in good faith to resolve it."),
        ("c", "6.3\tProvider may increase the Fees for any Renewal Term by giving Customer written notice at least sixty (60) days before the Renewal Term begins"
              "{+, provided that no increase may exceed five percent (5%) of the Fees for the preceding twelve (12) months+}."),
        ("c", "6.4\tUndisputed amounts not paid when due bear interest at the lesser of one percent (1%) per month and the maximum rate permitted by law."),
        ("c", "6.5\tThe Fees exclude sales, use and similar taxes, which Customer shall pay, other than taxes based on Provider's net income."),

        ("h", "7.  INTELLECTUAL PROPERTY"),
        ("c", "7.1\tAs between the parties, Customer owns the Customer Data and the Deliverables. Provider hereby assigns to Customer all right, title and "
              "interest in the Deliverables, effective on creation, and shall sign any document Customer reasonably requests to perfect that assignment."),
        ("c", "7.2\tProvider retains all rights in the Provider Materials. To the extent any Provider Materials are incorporated in a Deliverable, Provider "
              "grants Customer a perpetual, worldwide, royalty-free, non-exclusive license to use them as part of that Deliverable."),
        ("c", "7.3\tProvider shall not use Customer Data or Deliverables to train, fine-tune or evaluate any machine learning model other than for "
              "Customer, or to provide services to any other person."),

        ("h", "8.  WARRANTIES"),
        ("c", "8.1\tEach party warrants that it has full power and authority to enter into and perform this Agreement."),
        ("c", "8.2\tProvider warrants that it shall perform the Services in a professional and workmanlike manner consistent with industry standards, "
              "and in compliance with all applicable laws, including employment and wage laws for the personnel who perform the Services."),
        ("c", "8.3\tEXCEPT AS EXPRESSLY SET OUT IN THIS AGREEMENT, NEITHER PARTY MAKES ANY OTHER WARRANTY, EXPRESS OR IMPLIED, INCLUDING ANY IMPLIED "
              "WARRANTY OF MERCHANTABILITY OR FITNESS FOR A PARTICULAR PURPOSE."),

        ("h", "9.  CONFIDENTIALITY"),
        ("c", '9.1\t"**Confidential Information**" means all non-public information a party discloses to the other in connection with this Agreement '
              "that is marked as confidential or that a reasonable person would understand to be confidential. Customer Data is Customer's Confidential Information."),
        ("c", "9.2\tThe receiving party shall use the disclosing party's Confidential Information only to perform its obligations or exercise its rights "
              "under this Agreement, shall not disclose it except to its employees and contractors who need to know it and are bound by obligations of "
              "confidentiality at least as protective as these, and shall protect it with at least reasonable care."),
        ("c", "9.3\tThese obligations do not apply to information that is or becomes public through no fault of the receiving party, was lawfully known "
              "to it before disclosure, is lawfully received from a third party without restriction, or is independently developed without use of the "
              "Confidential Information. The receiving party may disclose Confidential Information where required by law, after giving the disclosing party "
              "prompt notice where legally permitted."),

        ("h", "10.  DATA PROTECTION AND SECURITY"),
        ("c", "10.1\tProvider shall process Customer Data only on Customer's documented instructions and only to perform the Services. The parties' "
              "Data Processing Addendum, dated as of the Effective Date, forms part of this Agreement."),
        ("c", "10.2\tProvider shall maintain the administrative, physical and technical safeguards described in its SOC 2 Type II report, including "
              "encryption of Customer Data in transit and at rest, multi-factor authentication for all personnel, and role-based access controls."),
        ("c", "10.3\tProvider shall notify Customer without undue delay, and in any event within seventy-two (72) hours, after becoming aware of any "
              "unauthorized access to or disclosure of Customer Data, and shall provide the information Customer reasonably requests to investigate it."),
        ("c", "10.4\tOn expiry or termination of the Services, Provider shall return or securely delete all Customer Data within thirty (30) days, "
              "at Customer's election, and certify the deletion in writing."),

        ("h", "11.  LIMITATION OF LIABILITY"),
        ("c", "11.1\tExcept as provided in Section 11.3, neither party is liable for any indirect, incidental, special, consequential or punitive "
              "damages, or for any loss of profits, revenue or data, arising out of or relating to this Agreement, even if advised of their possibility."),
        ("c", "11.2\tExcept as provided in Section 11.3, each party's total liability arising out of or relating to this Agreement shall not exceed the "
              "total fees paid or payable by Customer in the [-three (3) months-]{+twelve (12) months+} preceding the event giving rise to the claim."),
        ("c", "11.3\tThe exclusions and limitations in this Section 11 do not apply to liability that cannot be limited or excluded under applicable law"
              "{+, or to a party's breach of Section 9 (Confidentiality) or Section 10 (Data Protection and Security), or to Provider's obligations under "
              "Section 12.1 (Indemnification)+}."),

        ("h", "12.  INDEMNIFICATION"),
        ("c", "12.1\tProvider shall defend Customer and its Affiliates against any third-party claim that the Services, the Deliverables or the "
              "Provider Materials infringe or misappropriate any intellectual property right, and shall pay any damages, costs and reasonable attorneys' "
              "fees finally awarded or agreed in settlement."),
        ("c", "12.2\tCustomer shall defend Provider against any third-party claim that Provider's use of the Customer Data in accordance with this "
              "Agreement infringes that third party's rights, and shall pay any damages, costs and reasonable attorneys' fees finally awarded or agreed in settlement."),
        ("c", "12.3\tThe indemnified party shall notify the indemnifying party promptly of the claim, give it sole control of the defense and settlement "
              "(except that no settlement may impose any obligation on the indemnified party without its consent), and provide reasonable cooperation at the indemnifying party's expense."),

        ("h", "13.  TERMINATION"),
        ("c", "13.1\tEither party may terminate this Agreement or any Statement of Work by written notice if the other party materially breaches it and "
              "fails to cure the breach within thirty (30) days of written notice describing it."),
        ("c", "13.2\tEither party may terminate this Agreement immediately by written notice if the other party becomes insolvent, makes a general "
              "assignment for the benefit of creditors, or becomes the subject of any bankruptcy proceeding that is not dismissed within sixty (60) days."),
        ("c", "13.3\tOn termination, Customer shall pay the Fees for Services performed up to the date of termination, and Provider shall deliver all "
              "completed and in-progress Deliverables and comply with Section 10.4."),
        ("c", "13.4\tSections 7, 9, 10.4, 11, 12, 13.3, 15 and 16 survive termination or expiry of this Agreement."),

        ("h", "14.  INSURANCE"),
        ("c", "14.1\tDuring the term and for one (1) year after it, Provider shall maintain commercial general liability insurance of at least "
              "$2,000,000 per occurrence, and technology errors and omissions and cyber liability insurance of at least $5,000,000 per claim, and shall "
              "provide certificates of insurance on Customer's request."),

        ("h", "15.  GENERAL"),
        ("c", "15.1\tThe parties are independent contractors. Nothing in this Agreement creates a partnership, joint venture, agency or employment relationship."),
        ("c", "15.2\tNeither party may assign this Agreement without the other's prior written consent, except to a successor to all or substantially "
              "all of its business or assets to which this Agreement relates, on written notice."),
        ("c", "15.3\tNotices must be in writing and delivered by hand, by courier or by email with confirmation of receipt to the addresses in the "
              "signature block, or to any other address a party designates by notice."),
        ("c", "15.4\tNeither party is liable for any delay or failure to perform caused by events beyond its reasonable control, other than payment "
              "obligations, provided it notifies the other party promptly and uses reasonable efforts to resume performance."),
        ("c", "15.5\tThis Agreement, its Schedules and each Statement of Work are the parties' entire agreement on their subject matter and supersede "
              "all prior agreements and understandings, including the parties' Master Services Agreement dated December 1, 2023."),
        ("c", "15.6\tThis Agreement may be amended only in a writing signed by both parties, and may be signed in counterparts, including by electronic signature."),

        ("h", "16.  GOVERNING LAW AND DISPUTES"),
        ("c", "16.1\tThis Agreement is governed by the laws of the State of California, without regard to its conflict of laws rules."),
        ("c", "16.2\tThe state and federal courts located in San Francisco County, California have exclusive jurisdiction over any dispute arising out "
              "of or relating to this Agreement, and each party submits to their jurisdiction."),

        ("gap",),
        ("p", "IN WITNESS WHEREOF, the parties have executed this Agreement as of the Effective Date."),
        ("sig", "**HARBOR & PINE DATA SERVICES, LLC**"),
        ("sig", "By: ______________________________"),
        ("sig", "Name: Laura Mendes"),
        ("sig", "Title: Chief Executive Officer"),
        ("sig", "Address: 1200 Embarcadero West, Oakland, CA 94607"),
        ("gap",),
        ("sig", "**ALIA, INC.**"),
        ("sig", "By: ______________________________"),
        ("sig", "Name: Daniel Okafor"),
        ("sig", "Title: Chief Financial Officer"),
        ("sig", "Address: 500 Townsend Street, San Francisco, CA 94103"),

        ("annex", "SCHEDULE 1: SERVICES"),
        ("c", "1.\tData annotation: labelling of text, conversation and agent-trajectory data against Customer's guidelines, including preference "
              "ranking, rubric scoring and red-team review."),
        ("c", "2.\tEvaluation sets: design, curation and maintenance of held-out evaluation sets for Customer's models, refreshed quarterly."),
        ("c", "3.\tQuality assurance: second-pass review of at least ten percent (10%) of labelled items, calibration sessions with Customer's research "
              "team each month, and a monthly quality report."),
        ("c", "4.\tProgram management: a named program manager, weekly status reports and a quarterly business review."),

        ("annex", "SCHEDULE 2: SERVICE LEVELS"),
        ("c", "1.\tTurnaround: ninety-five percent (95%) of batches of up to 20,000 items delivered within five (5) business days of receipt."),
        ("c", "2.\tAccuracy: at least ninety-eight percent (98%) agreement with Customer's gold-standard labels, measured monthly."),
        ("c", "3.\tSupport: Standard Support from 8 a.m. to 6 p.m. Pacific Time on business days, with a response within four (4) business hours. "
              "Priority Support, available for an additional fee under Schedule 3, provides a response within one (1) hour, twenty-four (24) hours a day."),
        ("c", "4.\tService credits: five percent (5%) of the monthly Fees for each service level missed in a month, up to fifteen percent (15%) in total."),

        ("annex", "SCHEDULE 3: FEES"),
        ("c", "1.\tMonthly Fee: $18,000, covering up to 400,000 labelled items and the evaluation-set and quality assurance Services each month."),
        ("c", "2.\tAdditional items: $0.05 per labelled item above 400,000 in a month."),
        ("c", "3.\tPriority Support (optional): $2,500 per month."),
        ("c", "4.\tStatements of Work for projects outside Schedule 1 are priced in the Statement of Work."),
    ],
}


def strip(text):
    """The draft as Harbor & Pine sent it: deletions kept, insertions dropped."""
    text = re.sub(r"\{\+.*?\+\}", "", text, flags=re.S)
    return re.sub(r"\[-(.*?)-\]", r"\1", text, flags=re.S)


ORIGINAL = {**MSA, "blocks": [(kind, *(strip(t) for t in rest)) for kind, *rest in MSA["blocks"]]}

CONTRACTS = {"msa": MSA, "msa-original": ORIGINAL}
