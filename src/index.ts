//!native
//!nocheck
//!nolint
//!optimize 2

import Observers from "@rbxts/observers";
import { GroupService, Players, RunService } from "@rbxts/services";
import safeThreadCancel from "./safe-thread-cancel";

function getGroupsAsync(userId: number) {
	return GroupService.GetGroupsAsync(userId);
}
const getTime = RunService.IsRunning() ? time : os.clock;

/**
 * # Grouper
 *
 * Used for getting the latest group rank or role of a player on the server.
 */
namespace Grouper {
	type OnRankChangedCallback = (player: Player, newRank: number, oldRank: number) => void;

	const playerRanks = new Map<number, Array<thread> | number>();
	const roleCache = new Array<string>(256, "Guest") as never as Map<number, string>;
	const onRankChangedCallbacks = new Array<Array<OnRankChangedCallback>>();
	let hasInitialized = false;

	export const configuration: {
		groupId: number;
		rankRefreshRate: number;
	} = {
		groupId: 0,
		rankRefreshRate: 30,
	};

	function fetchRank(userId: number, groupId: number): number | undefined {
		const [success, groups] = pcall(getGroupsAsync, userId);

		if (!success) {
			warn(`[GROUPER] Couldn't fetch rank for user ${userId}\n\texception: ${groups}`);
			return undefined;
		}

		for (const group of groups) {
			if (group.Id !== groupId) continue;

			const rank = group.Rank;
			roleCache.set(rank + 1, group.Role);
			return rank;
		}
	}

	export function initialize(newConfiguration: { groupId: number; rankRefreshRate?: number }) {
		if (hasInitialized) return;
		for (const [key, value] of pairs(newConfiguration)) configuration[key] = value;
		hasInitialized = true;

		Observers.observePlayer((player) => {
			const { groupId, rankRefreshRate } = configuration;
			const userId = player.UserId;

			let canRun = true;
			let killThread: thread | undefined;

			const startTime = getTime();
			let rank = fetchRank(userId, groupId) ?? 0;

			if (player?.IsDescendantOf(Players)) {
				const threadsWaiting = playerRanks.get(userId) as Array<thread>;
				playerRanks.set(userId, rank);
				if (typeIs(threadsWaiting, "table")) for (const thread of threadsWaiting) task.spawn(thread, rank);

				const timeDifference = getTime() - startTime;
				if (timeDifference < rankRefreshRate) task.wait(rankRefreshRate - timeDifference);

				killThread = task.spawn(() => {
					while (canRun && playerRanks.has(userId)) {
						const newRank = fetchRank(userId, groupId);
						if (!playerRanks.has(userId)) return;

						if (newRank !== undefined && newRank !== rank) {
							playerRanks.set(userId, newRank);
							for (const [callback] of onRankChangedCallbacks)
								task.spawn(callback, player, newRank, rank);
							rank = newRank;
						}

						task.wait(rankRefreshRate);
					}
				});
			} else playerRanks.delete(userId);

			return () => {
				canRun = false;
				if (killThread) safeThreadCancel(killThread);
				killThread = undefined;
				playerRanks.delete(userId);
			};
		});
	}

	export function onRankChanged(callback: OnRankChangedCallback) {
		const data = [callback];
		onRankChangedCallbacks.push(data);

		return () => {
			const index = onRankChangedCallbacks.indexOf(data);
			if (index === -1) return;

			// biome-ignore lint/performance/noDelete: SHUT UP!!!!!!!!
			if (index === 0) delete onRankChangedCallbacks[0];
			else onRankChangedCallbacks.unorderedRemove(index);
		};
	}

	export function getRank(player: Player): number {
		const rank = playerRanks.get(player.UserId);
		if (typeIs(rank, "number")) return rank;

		if (rank) {
			rank.push(coroutine.running());
			return coroutine.yield()[0] as number;
		}

		if (player?.IsDescendantOf(Players)) {
			playerRanks.set(player.UserId, [coroutine.running()]);
			return coroutine.yield()[0] as number;
		}

		throw "[GROUPER] Player has left game too early";
	}

	export function getRankAndRole(player: Player) {
		const rank = getRank(player);
		return $tuple(rank, roleCache.get(rank + 1));
	}

	export function isInGroup(player: Player) {
		return getRank(player) !== 0;
	}

	export function getRole(player: Player) {
		return roleCache.get(getRank(player) + 1);
	}
}

export = Grouper;
