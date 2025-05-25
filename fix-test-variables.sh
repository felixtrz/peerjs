#!/bin/bash
set -e

echo "Fixing test variable references..."

# Fix standalone node references that weren't caught
perl -i -pe 's/\bnode\.(peer|metadata|open|destroyed|connectionCount)\b/remoteNode.$1/g' __test__/remote-node.spec.ts
perl -i -pe 's/\bnode\._/remoteNode._/g' __test__/remote-node.spec.ts
perl -i -pe 's/\bnode\.on\(/remoteNode.on(/g' __test__/remote-node.spec.ts
perl -i -pe 's/\bnode\.send\(/remoteNode.send(/g' __test__/remote-node.spec.ts
perl -i -pe 's/\bnode\.getConnection\(/remoteNode.getConnection(/g' __test__/remote-node.spec.ts
perl -i -pe 's/\bnode\.close\(/remoteNode.close(/g' __test__/remote-node.spec.ts
perl -i -pe 's/\bnode\.disconnect\(/remoteNode.disconnect(/g' __test__/remote-node.spec.ts
perl -i -pe 's/jest\.spyOn\(node,/jest.spyOn(remoteNode,/g' __test__/remote-node.spec.ts

# Fix standalone peer references
perl -i -pe 's/\bpeer,\s*"_removeNode"/meshClient as any, "_removeNode"/g' __test__/remote-node.spec.ts
perl -i -pe 's/jest\.spyOn\(peer,/jest.spyOn(meshClient as any,/g' __test__/remote-node.spec.ts

# Fix afterEach references
perl -i -pe 's/if \(node && !node\.destroyed\)/if (remoteNode \&\& !remoteNode.destroyed)/g' __test__/remote-node.spec.ts
perl -i -pe 's/if \(peer && !peer\.destroyed\)/if (meshClient \&\& !meshClient.destroyed)/g' __test__/remote-node.spec.ts

# Fix expect(node. patterns
perl -i -pe 's/expect\(node\./expect(remoteNode./g' __test__/remote-node.spec.ts

# Fix Object.defineProperty calls
perl -i -pe 's/Object\.defineProperty\(peer,/Object.defineProperty(meshClient,/g' __test__/remote-node.spec.ts

# Fix MockDataConnection constructor calls
perl -i -pe 's/, peer, node,/, meshClient, remoteNode,/g' __test__/remote-node.spec.ts

# Fix node references in expect().toHaveBeenCalledWith
perl -i -pe 's/\.toHaveBeenCalledWith\(node\)/.toHaveBeenCalledWith(remoteNode)/g' __test__/remote-node.spec.ts

echo "Fixed test variable references!"