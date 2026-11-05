// La réponse de PostgREST est plafonnée (`max_rows`, 1 000 lignes) : une lecture complète se fait page par page. La
// requête doit trier sur une clé unique, pour que les pages ne se chevauchent pas.

const PAGE = 1000;

type Page<T> = { data: T[] | null; error: { code: string; message: string } | null };

/** Toutes les lignes d'une requête, page par page. `quoi` nomme la lecture dans le message d'erreur. */
export async function toutLire<T>(lire: (debut: number, fin: number) => PromiseLike<Page<T>>, quoi: string): Promise<T[]> {
  const tout: T[] = [];
  for (let debut = 0; ; debut += PAGE) {
    const { data, error } = await lire(debut, debut + PAGE - 1);
    if (error) throw new Error(`${quoi} : ${error.code} ${error.message}`);
    tout.push(...(data ?? []));
    if ((data ?? []).length < PAGE) return tout;
  }
}
