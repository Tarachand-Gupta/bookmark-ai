/** All keys share the user's Redis cluster hash tag. Fence + mutation + event
 * execute together; an OFF accepted before this commit cannot be undone by it. */
export const SET_EXTENSION_PUBLISHING = `
redis.call('HINCRBY', KEYS[2], 'epoch', 1)
redis.call('HSET', KEYS[2], 'enabled', ARGV[1])
if ARGV[1] == '1' then
  redis.call('SET', KEYS[1], '1')
else
  redis.call('DEL', KEYS[3])
  redis.call('ZREM', KEYS[4], ARGV[2])
  redis.call('PUBLISH', KEYS[5], ARGV[3])
end
return 1
`;

export const COMMIT_EXTENSION_SNAPSHOT = `
local epoch = redis.call('HGET', KEYS[2], 'epoch') or '0'
if redis.call('GET', KEYS[1]) ~= '1'
  or redis.call('HGET', KEYS[2], 'enabled') == '0' then return 0 end
-- The unchanged extension treats disabled=false/403 as a command to stop.
-- After explicit ON, acknowledge an older epoch without committing its data.
if epoch ~= ARGV[1] then return 3 end
if ARGV[2] == 'heartbeat' and redis.call('EXISTS', KEYS[3]) == 0 then return 2 end
local fields = cjson.decode(ARGV[3])
for field, value in pairs(fields) do redis.call('HSET', KEYS[3], field, value) end
if ARGV[2] == 'full' then redis.call('HSETNX', KEYS[3], 'createdAt', ARGV[4]) end
redis.call('ZADD', KEYS[4], ARGV[5], ARGV[9])
redis.call('EXPIRE', KEYS[3], ARGV[6])
if ARGV[7] == '1' then redis.call('PUBLISH', KEYS[5], ARGV[8]) end
return 1
`;
