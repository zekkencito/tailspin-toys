import { and, asc, eq, inArray } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { Database } from "./db";
import { games, categories, publishers } from "../../db/schema";
import type { Category, Game, Publisher } from "../types/game";

const gameSelection = {
    id: games.id,
    title: games.title,
    description: games.description,
    starRating: games.starRating,
    categoryId: categories.id,
    categoryName: categories.name,
    publisherId: publishers.id,
    publisherName: publishers.name,
};

type GameSelectionRow = {
    id: number;
    title: string;
    description: string;
    starRating: number | null;
    categoryId: number | null;
    categoryName: string | null;
    publisherId: number | null;
    publisherName: string | null;
};

export interface GameFilters {
    categoryNames?: string[];
    publisherName?: string;
}

function mapGame(row: GameSelectionRow): Game {
    return {
        id: row.id,
        title: row.title,
        description: row.description,
        starRating: row.starRating,
        category:
            row.categoryId !== null && row.categoryName !== null
                ? { id: row.categoryId, name: row.categoryName }
                : null,
        publisher:
            row.publisherId !== null && row.publisherName !== null
                ? { id: row.publisherId, name: row.publisherName }
                : null,
    };
}

function baseGamesQuery(db: Database) {
    return db
        .select(gameSelection)
        .from(games)
        .leftJoin(categories, eq(games.categoryId, categories.id))
        .leftJoin(publishers, eq(games.publisherId, publishers.id));
}

/**
 * Returns games matching the selected category and publisher filters.
 * @param db Injectable database used by the caller or its tests.
 * @param filters Optional category names and publisher name to apply.
 * @returns Matching games sorted alphabetically by title.
 */
export async function getFilteredGames(
    db: Database,
    filters: GameFilters = {},
): Promise<Game[]> {
    const conditions: SQL<unknown>[] = [];

    if (filters.categoryNames && filters.categoryNames.length > 0) {
        conditions.push(inArray(categories.name, filters.categoryNames));
    }

    if (filters.publisherName) {
        conditions.push(eq(publishers.name, filters.publisherName));
    }

    const query = baseGamesQuery(db);
    const rows =
        conditions.length > 0
            ? await query.where(and(...conditions)).orderBy(asc(games.title))
            : await query.orderBy(asc(games.title));
    return rows.map(mapGame);
}

/**
 * Returns every game ordered by title.
 * @param db Injectable database used by the caller or its tests.
 * @returns All games sorted alphabetically by title.
 */
export async function getAllGames(db: Database): Promise<Game[]> {
    return getFilteredGames(db);
}

/**
 * Returns all categories available for filtering.
 * @param db Injectable database used by the caller or its tests.
 * @returns Categories sorted alphabetically by name.
 */
export async function getAllCategories(db: Database): Promise<Category[]> {
    return db
        .select({ id: categories.id, name: categories.name })
        .from(categories)
        .orderBy(asc(categories.name));
}

/**
 * Returns all publishers available for filtering.
 * @param db Injectable database used by the caller or its tests.
 * @returns Publishers sorted alphabetically by name.
 */
export async function getAllPublishers(db: Database): Promise<Publisher[]> {
    return db
        .select({ id: publishers.id, name: publishers.name })
        .from(publishers)
        .orderBy(asc(publishers.name));
}

/**
 * Returns all game ids ordered by title.
 * @param db Injectable database used by the caller or its tests.
 * @returns Game IDs sorted alphabetically by title.
 */
export async function getAllGameIds(db: Database): Promise<number[]> {
    const rows = await db.select({ id: games.id }).from(games).orderBy(asc(games.title));
    return rows.map((row) => row.id);
}

/**
 * Returns a single game by ID.
 * @param db Injectable database used by the caller or its tests.
 * @param id Game ID to look up.
 * @returns The matching game, or null when it does not exist.
 */
export async function getGameById(db: Database, id: number): Promise<Game | null> {
    const row = await baseGamesQuery(db).where(eq(games.id, id)).get();
    return row ? mapGame(row) : null;
}
