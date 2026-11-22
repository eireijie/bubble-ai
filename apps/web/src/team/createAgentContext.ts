import { createContext, useContext } from "react";

/** Lets a field that picks an agent offer "Create an agent…": the builder shows the dialog and hands the new agent back. */
export const CreateAgentContext = createContext<((done: (agentId: string) => void) => void) | null>(null);
export const useCreateAgent = () => useContext(CreateAgentContext);
