import ContractTemplate from '../models/ContractTemplate.js';
import Installment from '../models/Installment.js';
import Loan from '../models/Loan.js';
import { getCloudinary } from '../config/cloudinary.js';
import { writeAudit } from '../services/auditService.js';
import { AppError } from '../utils/AppError.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const TEMPLATE_CODE = 'LOAN_CONTRACT';

const DEFAULT_CONTRACT_BODY = `“Installment Agreement”, the Lender and the Borrower agree to and jointly abide by this Agreement. Adhering to the principles of equity, voluntary participation, honesty and good reputation, this small loan agreement is signed and shall be observed and performed by both parties.

Article 1
Loan Form: Use an unsecured ID card to request a loan.

Article 2
Premium interest rate:

Interest rates, fines, service charges or any fees shall total no more than 25% per year.

Article 3
During the loan tenure, the borrower has to:
(1) Pay interest at the same time.
(2) Repay the principal on time.
(3) If payment cannot be made from the account due to a problem involving the borrower, the borrower shall cooperate with the lender to finalize the payment.
(4) Comply with all the terms of the contract.

Article 4
(1) In case the borrower borrows online without using collateral, the lender is at risk of lending. The borrower must provide the information required for the lender to check the borrower’s financial liquidity and minimum repayment capacity.
(2) In the case of online borrowing without collateral, the borrower must show their financial status to the company to confirm their ability to repay the debt before withdrawing the full approved loan amount.
(3) After signing this contract, both the borrower and the lender must comply with all requirements of the contract. If either party breaches the contract, the other party may pursue the remedies available under applicable law.
(4) If the credit transfer cannot be resolved because of a problem involving the borrower, the lender may request the borrower’s assistance. After the operation is completed, the lender shall transfer the funds.
(5) The borrower shall repay the loan principal and interest within the period specified in the contract. If the borrower wants to apply for a loan extension, the request must be submitted at least 5 days before the end of the contract period.
(6) If the borrower does not repay on the stipulated repayment date, penalty interest may be calculated after three days at 0.3% per day, subject to applicable law.

Article 5
Lending: Before granting a loan, the lender has the right to consider the following matters and decide whether to grant the loan after review:
(1) Whether the borrower has completed the legal formalities, if any, relating to the loan, including required government permits, approvals, registrations and relevant legal requirements.
(2) Whether the borrower has paid the costs associated with this Agreement, if any.
(3) Whether the borrower has complied with the loan terms specified in this Agreement.
(4) Whether the business and financial position of the borrower has changed adversely.
(5) Whether the borrower has breached the terms specified in this Agreement.

Article 6
(1) The borrower shall not use the loan for illegal activities. Otherwise, the lender reserves the right to require prompt repayment of the principal and interest, and the borrower shall bear the applicable legal consequences.
(2) The borrower shall repay the principal and interest within the period specified in the contract. For any overdue portion, the lender may recover the loan and collect applicable charges, subject to applicable law.

Article 7
Modification or termination of contract: Neither party may modify or terminate this contract without the agreement of the other party, except as allowed by applicable law. A party requesting modification or termination must notify the other party in writing in time for settlement. Any repayment required following modification or termination shall be handled according to this Agreement and applicable law.`;

function defaultTemplate() {
  return {
    templateCode: TEMPLATE_CODE,
    title: 'Loan Contract',
    beneficiaryBankName: '',
    body: DEFAULT_CONTRACT_BODY,
    status: 'ACTIVE'
  };
}

async function getOrCreateTemplate() {
  return ContractTemplate.findOneAndUpdate(
    { templateCode: TEMPLATE_CODE },
    { $setOnInsert: defaultTemplate() },
    { returnDocument: 'after', upsert: true, setDefaultsOnInsert: true }
  ).populate('updatedBy', 'displayName');
}

function borrowerSignatureUrl(signature) {
  if (!signature?.publicId || !signature?.format) return null;

  const expiresAt = Math.floor(Date.now() / 1000) + 5 * 60;
  const url = getCloudinary().utils.private_download_url(
    signature.publicId,
    signature.format,
    {
      resource_type: 'image',
      type: signature.deliveryType || 'authenticated',
      expires_at: expiresAt,
      attachment: false
    }
  );

  return {
    url,
    expiresAt: new Date(expiresAt * 1000).toISOString()
  };
}

export const getContractTemplate = asyncHandler(async (_req, res) => {
  const template = await getOrCreateTemplate();
  res.json({ success: true, item: template });
});

export const updateContractTemplate = asyncHandler(async (req, res) => {
  const {
    title,
    beneficiaryBankName = '',
    body,
    status = 'ACTIVE'
  } = req.body;

  if (!title?.trim() || !body?.trim()) {
    throw new AppError('Contract title and agreement content are required', 422);
  }

  if (!['ACTIVE', 'INACTIVE'].includes(status)) {
    throw new AppError('Invalid contract status', 422);
  }

  const template = await ContractTemplate.findOneAndUpdate(
    { templateCode: TEMPLATE_CODE },
    {
      $set: {
        title: title.trim(),
        beneficiaryBankName: beneficiaryBankName.trim(),
        body: body.trim(),
        status,
        updatedBy: req.user._id
      },
      $setOnInsert: { templateCode: TEMPLATE_CODE }
    },
    {
      returnDocument: 'after',
      upsert: true,
      runValidators: true,
      setDefaultsOnInsert: true
    }
  ).populate('updatedBy', 'displayName');

  await writeAudit({
    req,
    action: 'CONTRACT_TEMPLATE_UPDATED',
    entityType: 'CONTRACT_TEMPLATE',
    entityId: template._id,
    newValues: {
      title: template.title,
      beneficiaryBankName: template.beneficiaryBankName,
      status: template.status
    }
  });

  res.json({ success: true, item: template });
});

export const getLoanContract = asyncHandler(async (req, res) => {
  const [loan, template] = await Promise.all([
    Loan.findById(req.params.loanId)
      .populate('customerId', 'customerCode name firstName middleName lastName nationalId phone email')
      .populate(
        'applicationId',
        'applicationNumber applicantSnapshot signature termsAcceptedAt'
      )
      .populate('approvedBy', 'displayName'),
    getOrCreateTemplate()
  ]);

  if (!loan) throw new AppError('Loan not found', 404);

  const installments = await Installment.find({ loanId: loan._id })
    .sort({ installmentNumber: 1 });

  const customer = loan.customerId;
  const application = loan.applicationId;
  const applicationSnapshot = application?.applicantSnapshot;
  const customerName = customer?.name ||
    [customer?.firstName, customer?.middleName, customer?.lastName]
      .filter(Boolean)
      .join(' ');
  const borrowerName = applicationSnapshot?.name || customerName;
  const firstInstallment = installments[0] || null;
  const signature = borrowerSignatureUrl(application?.signature);

  res.json({
    success: true,
    item: {
      template,
      borrower: {
        name: borrowerName || '—',
        customerCode: customer?.customerCode || '—',
        idNumber: applicationSnapshot?.idCardNumber || customer?.nationalId || '—',
        mobileNumber: customer?.phone || '—',
        email: customer?.email || '—',
        address: applicationSnapshot?.address || '—',
        bankName: applicationSnapshot?.bankName || '—',
        bankAccountNumber: applicationSnapshot?.bankAccountNumber || '—',
        signatureUrl: signature?.url || null,
        signatureUrlExpiresAt: signature?.expiresAt || null,
        termsAcceptedAt: application?.termsAcceptedAt || null
      },
      loan: {
        id: loan._id,
        loanNumber: loan.loanNumber,
        productName: loan.productSnapshot?.name || '—',
        principalAmount: loan.principalAmount,
        amountPerInstallment: firstInstallment?.totalDue || 0,
        installmentPayment: firstInstallment?.totalDue || 0,
        totalAmount: loan.totalPayable,
        term: loan.term,
        termUnit: loan.termUnit,
        creditTerm: `${loan.term} ${loan.termUnit.toLowerCase()}${loan.term === 1 ? '' : 's'}`,
        ratePercent: loan.rateSnapshot?.ratePercent,
        startDate: loan.startDate,
        maturityDate: loan.maturityDate,
        status: loan.status,
        approvedBy: loan.approvedBy?.displayName || '—'
      }
    }
  });
});
