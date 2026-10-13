import {
  createCandidateInviteAction,
  deleteCandidatePersonalDataAction,
  getCandidateInviteByIdAction,
  getCandidateInvitesForInterviewAction,
  getPublicCandidateInviteByTokenAction,
  revokeCandidateInviteAction,
} from "@/app/actions/candidates";
import { getConsentPolicyAction, recordConsentAction } from "@/app/actions/consents";
import type {
  ConsentPolicy,
  ConsentSubmitInput,
  ConsentSubmitResult,
  CreateCandidateInviteInput,
} from "@/types/candidate";

export const CandidateService = {
  createInvite(input: CreateCandidateInviteInput) {
    return createCandidateInviteAction(input);
  },
  getInvites(interviewId: string) {
    return getCandidateInvitesForInterviewAction(interviewId);
  },
  getInviteById(id: string, interviewId: string) {
    return getCandidateInviteByIdAction(id, interviewId);
  },
  deletePersonalData(id: string, interviewId: string) {
    return deleteCandidatePersonalDataAction(id, interviewId);
  },
  getPublicInviteByToken(token: string) {
    return getPublicCandidateInviteByTokenAction(token);
  },
  revokeInvite(id: string, interviewId: string) {
    return revokeCandidateInviteAction(id, interviewId);
  },
  /** 提交候选人同意留痕。只接受专属令牌，身份与 user-agent 摘要均由服务端生成。 */
  recordConsent(input: ConsentSubmitInput): Promise<ConsentSubmitResult> {
    return recordConsentAction(input);
  },
  /** 读取服务端权威的同意文案版本与留存月数。 */
  getConsentPolicy(): Promise<ConsentPolicy> {
    return getConsentPolicyAction();
  },
};
