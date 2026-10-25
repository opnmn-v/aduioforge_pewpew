import OBR from "@owlbear-rodeo/sdk";

/** Broadcast validates shape, not authority. Trust local controls only from this
 * connection, and room playback only from a connected GM. */
export async function syncAccess() {
  const [connectionId, role, players] = await Promise.all([
    OBR.player.getConnectionId(), OBR.player.getRole(), OBR.party.getPlayers(),
  ]);
  let localRole = role;
  let gmConnections = new Set(players.filter(player => player.role === "GM").map(player => player.connectionId));
  OBR.party.onChange(next => { gmConnections = new Set(next.filter(player => player.role === "GM").map(player => player.connectionId)); });
  OBR.player.onChange(player => { localRole = player.role; });
  return {
    local: (sender: string) => sender === connectionId,
    gm: (sender: string) => sender === connectionId ? localRole === "GM" : gmConnections.has(sender),
  };
}
