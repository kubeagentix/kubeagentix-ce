import { RequestHandler } from "express";
import { getCommandBroker, CommandBrokerError } from "../commands/broker";
import { BrokerExecuteRequest, BrokerSuggestRequest } from "@shared/terminal";
import { CommandSuggestionError, suggestCommand } from "../services/commandSuggestion";

export const handleCliExecute: RequestHandler = async (req, res) => {
  const payload = req.body as BrokerExecuteRequest;

  if (!payload?.command) {
    return res.status(400).json({
      error: {
        code: "COMMAND_INVALID",
        message: "Missing command",
        retryable: false,
      },
    });
  }

  try {
    const result = await getCommandBroker().execute(payload);
    res.json(result);
  } catch (error) {
    if (error instanceof CommandBrokerError) {
      const status =
        error.code === "COMMAND_BLOCKED"
          ? 403
          : error.code === "COMMAND_TIMEOUT"
            ? 408
            : 500;

      return res.status(status).json({
        error: {
          code: error.code,
          message: error.message,
          retryable: error.retryable,
          policyDecision: error.policyDecision,
        },
      });
    }

    return res.status(500).json({
      error: {
        code: "COMMAND_FAILED",
        message: error instanceof Error ? error.message : "Unknown error",
        retryable: true,
      },
    });
  }
};

export const handleCliSuggest: RequestHandler = async (req, res) => {
  const payload = req.body as BrokerSuggestRequest;

  if (!payload?.query) {
    return res.status(400).json({
      error: {
        code: "SUGGESTION_INVALID",
        message: "Missing query",
        retryable: false,
      },
    });
  }

  try {
    const suggestion = await suggestCommand(payload);
    res.json(suggestion);
  } catch (error) {
    if (error instanceof CommandSuggestionError) {
      const status =
        error.code === "SUGGESTION_BLOCKED"
          ? 403
          : error.code === "SUGGESTION_INVALID"
            ? 400
            : error.code === "SUGGESTION_UNAVAILABLE"
              ? 503
              : 500;

      return res.status(status).json({
        error: {
          code: error.code,
          message: error.message,
          retryable: error.retryable,
          policyDecision: error.policyDecision,
        },
      });
    }

    return res.status(500).json({
      error: {
        code: "SUGGESTION_FAILED",
        message: error instanceof Error ? error.message : "Unknown error",
        retryable: true,
      },
    });
  }
};
