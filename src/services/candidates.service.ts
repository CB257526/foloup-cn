import {
  createCandidateInviteAction,
  deleteCandidatePersonalDataAction,
  getCandidateInviteByIdAction,
  getCandidateInvitesForInterviewAction,
  getPublicCandidateInviteByTokenAction,
  recordCandidateConsentAction,
  revokeCandidateInviteAction,
} from "@/app/actions/candidates";
import type { CreateCandidateInviteInput } from "@/types/candidate";

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
  recordConsent(input: {
    id: string;
    interviewId: string;
    consentVersion: string;
    voiceProcessingAccepted: boolean;
    evaluationAccepted: boolean;
    cameraMonitoringAccepted: boolean;
    improvementAccepted: boolean;
    userAgent?: string | null;
  }) {
    return recordCandidateConsentAction(input);
  },
};
