import type { MissionCommand, RobotPose } from "@brash/contracts";
import {
  VDA5050_VERSION,
  type Vda5050Action,
  type Vda5050Identity,
  type Vda5050Order,
} from "./vda5050-types.js";

export function missionCommandToVda5050Order(
  command: MissionCommand,
  identity: Vda5050Identity,
  headerId: number,
  currentPose: RobotPose,
): Vda5050Order {
  const nodes: Vda5050Order["nodes"] = [{
    nodeId: `base:${command.commandId}`,
    sequenceId: 0,
    released: true,
    actions: [],
    nodeDescriptor: "Current robot position at order creation",
    nodePosition: { x: currentPose.x, y: currentPose.y, theta: currentPose.yaw, mapId: currentPose.mapId },
  }];
  const edges: Vda5050Order["edges"] = [];
  let actionIndex = 0;

  for (const step of command.steps) {
    if (step.type === "MOVE_TO") {
      const sequenceId = nodes.length * 2;
      edges.push({
        edgeId: `${command.commandId}:edge:${sequenceId - 1}`,
        sequenceId: sequenceId - 1,
        released: true,
        actions: [],
        edgeDescriptor: `Fleet route to ${step.target.stationId}`,
      });
      nodes.push({
        nodeId: `${step.target.stationId}:${sequenceId}`,
        sequenceId,
        released: true,
        actions: [],
        nodeDescriptor: `Fleet station ${step.target.stationId}`,
        nodePosition: { x: step.target.x, y: step.target.y, mapId: step.target.mapId },
      });
      continue;
    }
    const node = nodes.at(-1);
    if (!node) throw new Error("VDA 5050 action requires a preceding node.");
    actionIndex += 1;
    node.actions.push(stepToAction(step, command.commandId, actionIndex));
  }

  if (nodes.length < 2) throw new Error("VDA 5050 mission requires at least one MOVE_TO step.");
  return {
    headerId,
    timestamp: command.issuedAt,
    version: VDA5050_VERSION,
    ...identity,
    orderId: command.commandId,
    orderUpdateId: 0,
    orderDescription: `BRASH Fleet mission ${command.missionId}`,
    nodes,
    edges,
  };
}

function stepToAction(
  step: Exclude<MissionCommand["steps"][number], { type: "MOVE_TO" }>,
  commandId: string,
  index: number,
): Vda5050Action {
  if (step.type === "LOAD") {
    return {
      actionType: "pick",
      actionId: `${commandId}:action:${index}`,
      blockingType: "HARD",
      actionDescriptor: `Load at ${step.stationId}`,
      actionParameters: [
        { key: "stationId", value: step.stationId },
        { key: "payloadKg", value: step.payloadKg },
      ],
    };
  }
  return {
    actionType: "drop",
    actionId: `${commandId}:action:${index}`,
    blockingType: "HARD",
    actionDescriptor: `Unload at ${step.stationId}`,
    actionParameters: [{ key: "stationId", value: step.stationId }],
  };
}
