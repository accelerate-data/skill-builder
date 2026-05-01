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
import type { Document } from "@/lib/types";
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
    placeholderData: [],
  });
}

export function useDocumentSkillOptionsQuery() {
  return useQuery({
    queryKey: queryKeys.documents.skills,
    queryFn: listSkillsForDocuments,
    placeholderData: [],
  });
}

function useDocumentCacheUpdates() {
  const queryClient = useQueryClient();
  return {
    append: (documents: Document | Document[]) => {
      const nextDocuments = Array.isArray(documents) ? documents : [documents];
      queryClient.setQueryData<Document[]>(queryKeys.documents.list, (current = []) => [
        ...current.filter((doc) => !nextDocuments.some((next) => next.id === doc.id)),
        ...nextDocuments,
      ]);
    },
    update: (document: Document) => {
      queryClient.setQueryData<Document[]>(queryKeys.documents.list, (current = []) =>
        current.map((doc) => (doc.id === document.id ? document : doc)),
      );
    },
    remove: (id: number) => {
      queryClient.setQueryData<Document[]>(queryKeys.documents.list, (current = []) =>
        current.filter((doc) => doc.id !== id),
      );
    },
  };
}

export function useAddDocumentFileMutation() {
  const documentsCache = useDocumentCacheUpdates();
  return useMutation({
    mutationFn: ({ name, content, scope, skillIds }: AddDocumentFileInput) =>
      addDocumentFile(name, content, scope, skillIds),
    onSuccess: documentsCache.append,
  });
}

export function useAddDocumentUrlMutation() {
  const documentsCache = useDocumentCacheUpdates();
  return useMutation({
    mutationFn: ({ name, url, scope, skillIds }: AddDocumentUrlInput) =>
      addDocumentUrl(name, url, scope, skillIds),
    onSuccess: documentsCache.append,
  });
}

export function useAddDocumentFolderMutation() {
  const documentsCache = useDocumentCacheUpdates();
  return useMutation({
    mutationFn: ({ name, folderPath, scope, skillIds }: AddDocumentFolderInput) =>
      addDocumentFolder(name, folderPath, scope, skillIds),
    onSuccess: documentsCache.append,
  });
}

export function useUpdateDocumentMutation() {
  const documentsCache = useDocumentCacheUpdates();
  return useMutation({
    mutationFn: ({ id, scope, skillIds }: UpdateDocumentInput) =>
      updateDocument(id, scope, skillIds),
    onSuccess: documentsCache.update,
  });
}

export function useDeleteDocumentMutation() {
  const documentsCache = useDocumentCacheUpdates();
  return useMutation({
    mutationFn: deleteDocument,
    onSuccess: (_result, id) => documentsCache.remove(id),
  });
}
