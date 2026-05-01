import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  addDocumentFile,
  addDocumentFolder,
  addDocumentUrl,
  deleteDocument,
  listDocuments,
  listSkillsForDocuments,
  updateDocument,
} from "@/lib/tauri";
import { queryKeys } from "./query-keys";

interface AddDocumentFileInput {
  name: string;
  content: string;
  scope: "all" | "skill";
  skillIds: number[];
}

interface AddDocumentUrlInput {
  name: string;
  url: string;
  scope: "all" | "skill";
  skillIds: number[];
}

interface AddDocumentFolderInput {
  name: string;
  folderPath: string;
  scope: "all" | "skill";
  skillIds: number[];
}

interface UpdateDocumentInput {
  id: number;
  scope: "all" | "skill";
  skillIds: number[];
}

export function useDocumentsQuery() {
  return useQuery({
    queryKey: queryKeys.documents.list,
    queryFn: listDocuments,
    initialData: [],
  });
}

export function useDocumentSkillOptionsQuery() {
  return useQuery({
    queryKey: queryKeys.documents.skills,
    queryFn: listSkillsForDocuments,
    initialData: [],
  });
}

export function useInvalidateDocuments() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: queryKeys.documents.all });
}

function useInvalidateDocumentsOnSuccess() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: queryKeys.documents.all });
}

export function useAddDocumentFileMutation() {
  const invalidateDocuments = useInvalidateDocumentsOnSuccess();
  return useMutation({
    mutationFn: ({ name, content, scope, skillIds }: AddDocumentFileInput) =>
      addDocumentFile(name, content, scope, skillIds),
    onSuccess: invalidateDocuments,
  });
}

export function useAddDocumentUrlMutation() {
  const invalidateDocuments = useInvalidateDocumentsOnSuccess();
  return useMutation({
    mutationFn: ({ name, url, scope, skillIds }: AddDocumentUrlInput) =>
      addDocumentUrl(name, url, scope, skillIds),
    onSuccess: invalidateDocuments,
  });
}

export function useAddDocumentFolderMutation() {
  const invalidateDocuments = useInvalidateDocumentsOnSuccess();
  return useMutation({
    mutationFn: ({ name, folderPath, scope, skillIds }: AddDocumentFolderInput) =>
      addDocumentFolder(name, folderPath, scope, skillIds),
    onSuccess: invalidateDocuments,
  });
}

export function useUpdateDocumentMutation() {
  const invalidateDocuments = useInvalidateDocumentsOnSuccess();
  return useMutation({
    mutationFn: ({ id, scope, skillIds }: UpdateDocumentInput) =>
      updateDocument(id, scope, skillIds),
    onSuccess: invalidateDocuments,
  });
}

export function useDeleteDocumentMutation() {
  const invalidateDocuments = useInvalidateDocumentsOnSuccess();
  return useMutation({
    mutationFn: deleteDocument,
    onSuccess: invalidateDocuments,
  });
}
