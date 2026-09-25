export async function removeDepartmentRecord(client, departmentId) {
  return client.from('departamentos').delete().eq('id', departmentId);
}
