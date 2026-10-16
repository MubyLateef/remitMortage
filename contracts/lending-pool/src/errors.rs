// Copyright (c) 2026 RemitMortgage Protocol Contributors
// SPDX-License-Identifier: MIT

use soroban_sdk::contracterror;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum PoolError {
    // Soroban caps a contract error enum at 50 variants. Discriminants 11, 15,
    // 18, 19 and 27-31 belonged to variants nothing returned and are retired;
    // don't reuse them.
    /// Contract has already been initialized.
    AlreadyInitialized = 1,
    /// Contract has not been initialized yet.
    NotInitialized = 2,
    /// Amount must be greater than zero.
    InvalidAmount = 3,
    /// Only the admin can perform this action.
    Unauthorized = 4,
    /// Investor has insufficient balance to withdraw.
    InsufficientBalance = 5,
    /// Loan with this ID already exists.
    LoanAlreadyExists = 6,
    /// Loan not found.
    LoanNotFound = 7,
    /// Loan is not in the correct state for this operation.
    InvalidLoanState = 8,
    /// Insufficient pool liquidity for the requested disbursement.
    InsufficientLiquidity = 9,
    /// Repayment exceeds remaining loan balance.
    OverPayment = 10,
    /// Loan has already defaulted.
    AlreadyDefaulted = 12,
    /// Operation rejected because the contract is paused.
    ContractPaused = 13,
    /// Proposed new admin is not the caller or no transfer is pending.
    NotPendingAdmin = 14,
    /// Upgrade was proposed but the timelock delay has not elapsed yet.
    UpgradeTimelockActive = 16,
    /// Investor cannot change tranche after the initial deposit.
    TrancheMismatch = 17,
    /// The daily borrow limit has been exceeded.
    DailyBorrowLimitExceeded = 20,
    /// Refund amount exceeds the amount disbursed for the loan.
    RefundExceedsDisbursed = 21,
    /// Disbursement recipient is not a whitelisted contractor.
    UnauthorizedContractor = 22,
    /// Refinancing requires at least 3 successful payments.
    InsufficientPaymentHistory = 23,
    /// Interest rate for refinancing is below the allowed floor.
    InterestRateTooLow = 24,
    /// Loan cannot be refinanced.
    RefinanceNotEligible = 25,
    /// Loan is not yet overdue, so it cannot be marked as defaulted.
    LoanNotOverdue = 26,
    /// Loan maturity rebate has already been claimed.
    RebateAlreadyClaimed = 32,
    /// Loan has missed payments, so is ineligible for the maturity rebate.
    MissedPaymentsPreventRebate = 33,
    /// Loan must be in Approved state for this operation.
    LoanNotActive = 37,
    /// A restructure proposal already exists for this loan.
    RestructureProposalExists = 38,
    /// Proposed fee switch exceeds the hard protocol cap.
    FeeSwitchTooHigh = 39,
    /// No pending restructure proposal for this loan.
    NoRestructureProposal = 34,
    /// MultisigValidator contract address has not been configured.
    MultisigValidatorNotSet = 35,
    /// Investor withdrawal is blocked because the lockup period has not elapsed.
    LockupPeriodActive = 36,
    /// Deposit is below the pool's configured minimum deposit amount.
    DepositBelowMinimum = 40,
    /// Collateral release would breach the minimum collateralization ratio.
    CollateralRatioBreached = 41,
    /// No collateral available for release.
    NoCollateralToRelease = 42,
    /// Collateral has already been seized.
    CollateralAlreadySeized = 43,
    /// Invalid collateral ratio configuration.
    InvalidCollateralRatio = 44,
    /// Origination fee exceeds the full-disbursement ceiling.
    OriginationFeeTooHigh = 45,
    /// Borrower already holds the maximum number of active loans permitted by
    /// `max_active_loans_per_borrower`.
    BorrowerLoanCapExceeded = 46,
    /// Refinancing request was submitted before the cooldown window elapsed.
    RefinanceCooldownActive = 47,
    /// Application fee exceeds the ceiling permitted on a single application.
    ApplicationFeeTooHigh = 48,
    /// Withdrawal amount exceeds the pool's configured per-transaction limit.
    WithdrawalExceedsMaxSingleLimit = 50,
    /// No payoff quote exists for this loan.
    PayoffQuoteNotFound = 51,
    /// The payoff quote has expired; request a fresh quote.
    PayoffQuoteExpired = 52,
    /// Payoff quotes are disabled (window is zero) or the window is invalid.
    InvalidQuoteWindow = 53,
    /// Deposit attempted before the configured per-investor cooldown has elapsed.
    DepositCooldownActive = 54,
    /// Refinance execution attempted after the rate-lock window has expired.
    /// The borrower must call `request_refinance` again to obtain a fresh quote.
    RefinanceRateLockExpired = 55,
    /// No pending rate-lock exists for this loan; `request_refinance` must be
    /// called before `execute_refinance`.
    RefinanceRateLockNotFound = 56,
    /// Emergency liquidity injection requires an InsurancePool to be configured.
    InsurancePoolNotSet = 57,
    /// Emergency liquidity injection requires a GovernanceContract to be configured.
    GovernanceContractNotSet = 58,
    /// The referenced governance proposal has not reached `Passed` status.
    GovernanceProposalNotPassed = 59,
    /// Injection amount exceeds the configured percentage cap of insurance reserves.
    EmergencyInjectionCapExceeded = 60,
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum LoanAssumptionError {
    ContractPaused = 1,
    LoanNotFound = 2,
    LoanNotActive = 3,
    AssumptionNotAuthorized = 4,
    ApplicantNotVerified = 5,
    AssumptionNotFound = 6,
    AssumptionAlreadyRequested = 7,
}
