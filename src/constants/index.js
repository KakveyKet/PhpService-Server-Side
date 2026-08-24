export const ROLES = Object.freeze({
  CUSTOMER: 'CUSTOMER',
  USER: 'USER',
  ADMIN: 'ADMIN',
  SUPER_ADMIN: 'SUPER_ADMIN'
});

export const STAFF_ROLES = [ROLES.USER, ROLES.ADMIN, ROLES.SUPER_ADMIN];
export const ADMIN_ROLES = [ROLES.ADMIN, ROLES.SUPER_ADMIN];

export const PERMISSIONS = Object.freeze({
  CUSTOMER_VIEW: 'customer.view',
  CUSTOMER_MANAGE: 'customer.manage',
  PRODUCT_VIEW: 'product.view',
  PRODUCT_MANAGE: 'product.manage',
  APPLICATION_VIEW: 'application.view',
  APPLICATION_CREATE: 'application.create',
  APPLICATION_REVIEW: 'application.review',
  LOAN_VIEW: 'loan.view',
  LOAN_DISBURSE: 'loan.disburse',
  REPAYMENT_CREATE: 'repayment.create',
  REPORT_VIEW: 'report.view',
  USER_MANAGE: 'user.manage',
  AUDIT_VIEW: 'audit.view'
});
