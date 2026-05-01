import type {
  AppSettings,
  DeviceFlowResponse,
  GitHubAuthResult,
  GitHubUser,
  ModelInfo,
  ReconciliationResult,
  StartupDeps,
} from "@/lib/types";

export type NoArgs = Record<string, never>;

export interface TauriCommandMap {
  get_settings: { args: NoArgs; result: AppSettings };
  save_settings: { args: { settings: AppSettings }; result: void };
  update_user_settings: { args: { settings: AppSettings }; result: void };
  update_github_identity: {
    args: {
      login: string | null;
      avatar: string | null;
      email: string | null;
      token: string | null;
    };
    result: void;
  };
  test_api_key: { args: { apiKey: string }; result: boolean };
  get_data_dir: { args: NoArgs; result: string };
  get_default_skills_path: { args: NoArgs; result: string };
  list_models: { args: { apiKey: string }; result: ModelInfo[] };
  set_log_level: { args: { level: string }; result: void };
  check_startup_deps: { args: NoArgs; result: StartupDeps };
  reconcile_startup: { args: NoArgs | { apply: true }; result: ReconciliationResult };
  record_reconciliation_cancel: {
    args: { notificationCount: number; discoveredCount: number };
    result: void;
  };
  github_start_device_flow: { args: NoArgs; result: DeviceFlowResponse };
  github_poll_for_token: { args: { deviceCode: string }; result: GitHubAuthResult };
  github_get_user: { args: NoArgs; result: GitHubUser | null };
  github_logout: { args: NoArgs; result: void };
}

export type TauriCommandName = keyof TauriCommandMap;
export type TauriCommandArgs<Name extends TauriCommandName> = TauriCommandMap[Name]["args"];
export type TauriCommandResult<Name extends TauriCommandName> = TauriCommandMap[Name]["result"];
export type TauriCommandInvocation = {
  [Name in TauriCommandName]: [command: Name, args: TauriCommandArgs<Name>];
}[TauriCommandName];
