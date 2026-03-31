import { create } from "zustand";
import { listDocuments } from "@/lib/tauri";
import type { Document } from "@/lib/types";

interface DocumentState {
  documents: Document[];
  isLoading: boolean;
  fetchDocuments: () => Promise<void>;
  removeDocument: (id: number) => void;
  upsertDocument: (doc: Document) => void;
}

export const useDocumentStore = create<DocumentState>((set) => ({
  documents: [],
  isLoading: false,

  fetchDocuments: async () => {
    set({ isLoading: true });
    try {
      const documents = await listDocuments();
      set({ documents, isLoading: false });
    } catch (err) {
      console.error("event=fetch_documents_failed error=%s", err);
      set({ isLoading: false });
    }
  },

  removeDocument: (id) =>
    set((state) => ({ documents: state.documents.filter((d) => d.id !== id) })),

  upsertDocument: (doc) =>
    set((state) => {
      const idx = state.documents.findIndex((d) => d.id === doc.id);
      if (idx >= 0) {
        const updated = [...state.documents];
        updated[idx] = doc;
        return { documents: updated };
      }
      return { documents: [doc, ...state.documents] };
    }),
}));
