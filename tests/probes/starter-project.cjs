// D167: connecting the first service opens a new 独立讨论 and makes no project. Probes whose subject is a project's page, members
// and discussions get one the way 新建项目 makes it: a name and the lineup's members on the default service's model. This is
// page code (a string for executeJavaScript, or a function to call from page code): it only uses the app's own typed bridge.
async function starterProject(name) {
  const api = window.roundtable;
  const existing = (await api.rooms.listRooms()).find(room => room.name === name);
  if (existing) return existing.id;
  const providers = await api.settings.listProviderSummaries();
  const service = providers.find(provider => provider.isDefault && provider.enabled) ?? providers.find(provider => provider.enabled);
  const lineup = await api.rooms.getLineup();
  const members = await api.rooms.listAgentConfigurations({ roomId: lineup.id });
  const room = await api.rooms.createRoom({ name, objective: '' });
  for (const [index, member] of members.entries()) await api.rooms.createAgent({ roomId: room.id, displayName: member.displayName, roleTemplateId: member.roleTemplateId, systemPrompt: member.systemPrompt,
    providerId: service?.id ?? null, modelId: service?.defaultModelId ?? null, enabled: true, displayOrder: index });
  return room.id;
}
module.exports = { starterProject, starterProjectScript: name => `(${starterProject.toString()})(${JSON.stringify(name)})` };
