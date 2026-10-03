// Cooperative app-session revocation. Google grants and offline copies are not remotely erased.
export function sessionRevoked(devices, deviceId, authenticatedAt = 0) {
  const device = devices.find(d => d.id === deviceId);
  return !!device?.deletedAt && Date.parse(device.deletedAt) >= (authenticatedAt || 0);
}
