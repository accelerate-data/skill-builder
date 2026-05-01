import { useQueryClient } from "@tanstack/react-query";
import { appQueryClient } from "@/lib/query-client";
import { useDocumentsQuery } from "@/lib/queries/documents";
import { queryKeys } from "@/lib/queries/query-keys";
import type { Document } from "@/lib/types";

interface DocumentCompatState {
  documents: Document[];
  isLoading: boolean;
  fetchDocuments: () => Promise<void>;
  removeDocument: (id: number) => void;
  upsertDocument: (doc: Document) => void;
}

function setDocuments(updater: (documents: Document[]) => Document[]) {
  appQueryClient.setQueryData<Document[]>(queryKeys.documents.list, (current = []) =>
    updater(current),
  );
}

export function useDocumentStore<T>(selector: (state: DocumentCompatState) => T): T {
  const documentsQuery = useDocumentsQuery();
  const queryClient = useQueryClient();
  const state: DocumentCompatState = {
    documents: documentsQuery.data ?? [],
    isLoading: documentsQuery.isLoading,
    fetchDocuments: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.documents.list });
    },
    removeDocument: (id) => setDocuments((documents) => documents.filter((doc) => doc.id !== id)),
    upsertDocument: (doc) =>
      setDocuments((documents) => {
        const index = documents.findIndex((existing) => existing.id === doc.id);
        if (index === -1) return [doc, ...documents];
        const updated = [...documents];
        updated[index] = doc;
        return updated;
      }),
  };

  return selector(state);
}
