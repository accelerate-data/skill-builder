import { invokeCommand } from "@/lib/tauri";
import type { AppSettings } from "@/lib/types";

declare const settings: AppSettings;

void invokeCommand("get_settings", {});
void invokeCommand("save_settings", { settings });

// @ts-expect-error command names must be declared in TauriCommandMap
void invokeCommand("get_settingz", {});

// @ts-expect-error argument names must match the command contract
void invokeCommand("test_api_key", { api_key: "sk-ant-test" });

// @ts-expect-error command result is AppSettings, not string
const invalidSettingsResult: Promise<string> = invokeCommand("get_settings", {});
void invalidSettingsResult;

import type { TauriCommandName } from "@/lib/tauri-command-types";

declare const maybeCommand: TauriCommandName;

// @ts-expect-error widened command names must not decouple command and args
void invokeCommand(maybeCommand, {});
