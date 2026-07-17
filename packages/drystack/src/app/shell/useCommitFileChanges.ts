import { gql } from "@ts-gql/tag/no-transform";
import { useContext } from "react";
import { useMutation } from "urql";
import { base64Encode } from "#base64";
import { AppSlugContext } from "../onboarding/install-app";
import { useBaseCommit, useCurrentBranch, useRepoInfo } from "./data";

export const createCommitMutation = gql`
  mutation CreateCommit($input: CreateCommitOnBranchInput!) {
    createCommitOnBranch(input: $input) {
      ref {
        id
        target {
          id
          oid
          ... on Commit {
            tree {
              id
              oid
            }
          }
        }
      }
    }
  }
` as import("../../../__generated__/ts-gql/CreateCommit").type;

// Shared "commit straight to GitHub" primitive for 'github' storage, used by
// file-manager write actions (upload, trash, restore, permanent delete) -
// mirrors the mutation call in updating.tsx's
// useUpsertItem/useDeleteItem, but without their entry-save-specific
// STALE_DATA/BRANCH_PROTECTION_RULE_VIOLATION retry handling, since these
// file operations aren't retriable in the same way.
export function useCommitFileChanges() {
  const baseCommit = useBaseCommit();
  const currentBranch = useCurrentBranch();
  const repoInfo = useRepoInfo();
  const appSlug = useContext(AppSlugContext);
  const [, mutate] = useMutation(createCommitMutation);

  return async (args: {
    message: string;
    additions: { path: string; contents: Uint8Array }[];
    deletions: { path: string }[];
  }): Promise<
    { kind: "needs-fork" } | { kind: "ok" } | { kind: "error"; error: Error }
  > => {
    if (repoInfo && !repoInfo.hasWritePermission && appSlug?.value) {
      return { kind: "needs-fork" };
    }
    if (!repoInfo) {
      return { kind: "error", error: new Error("Repo info not loaded") };
    }
    const { error, data } = await mutate({
      input: {
        branch: {
          repositoryNameWithOwner: `${repoInfo.owner}/${repoInfo.name}`,
          branchName: currentBranch,
        },
        expectedHeadOid: baseCommit,
        message: { headline: args.message },
        fileChanges: {
          additions: args.additions.map((addition) => ({
            ...addition,
            contents: base64Encode(addition.contents),
          })),
          deletions: args.deletions,
        },
      },
    });
    if (
      error?.graphQLErrors.some(
        (err) =>
          "type" in err &&
          err.type === "FORBIDDEN" &&
          err.message === "Resource not accessible by integration",
      )
    ) {
      return {
        kind: "error",
        error: new Error(
          `The GitHub App is unable to commit to the repository. Please ensure that the drystack GitHub App is installed in the GitHub repository ${repoInfo.owner}/${repoInfo.name}`,
        ),
      };
    }
    if (error) {
      return { kind: "error", error };
    }
    if (!data?.createCommitOnBranch?.ref?.target) {
      return { kind: "error", error: new Error("Failed to update") };
    }
    return { kind: "ok" };
  };
}
