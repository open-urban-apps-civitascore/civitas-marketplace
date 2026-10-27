import { describe, expect, it } from 'vitest'

import { declinedStage, isNewerVersion, nextPatch, removalDeclinedNotice, reviewChangeNotice, shareProgress, takenOutNotice, turnLabel } from '@/lib/export/share-stages'

const verified = { state: 'verified' as const, mergedMrUrl: 'https://gitlab.example/mr/1' }

describe('shareProgress', () => {
    it('starts with the person proposing the package', () => {
        const progress = shareProgress({})
        expect(progress.states).toEqual({ propose: 'current', review: 'later', catalog: 'later', listing: 'later' })
        expect(turnLabel(progress)).toBe('Du bist dran')
        expect(progress.finished).toBe(false)
    })

    it('waits for the catalogue team once the package is submitted', () => {
        for (const facts of [{ bundle: { state: 'mr-open' as const } }, { bundleMrState: 'opened' }]) {
            const progress = shareProgress(facts)
            expect(progress.states.review).toBe('waiting')
            expect(progress.active).toBe('review')
            expect(turnLabel(progress)).toBe('Wartet auf das Katalog-Team')
            expect(progress.summary).toBe('Paket in Prüfung')
        }
    })

    it('hands back to the person after the merge, for the catalogue entry', () => {
        const progress = shareProgress({ bundleMrState: 'merged', bundle: { state: 'on-base', verification: verified }, catalog: { state: 'none' } })
        expect(progress.states).toEqual({ propose: 'done', review: 'done', catalog: 'current', listing: 'later' })
        expect(progress.summary).toBe('Paket angenommen - jetzt Katalog-Eintrag vorschlagen')
        expect(turnLabel(progress)).toBe('Du bist dran')
    })

    it('waits for the catalogue team on the entry, then is finished', () => {
        const waiting = shareProgress({ bundle: { state: 'on-base', verification: verified }, catalog: { state: 'mr-open', mrUrl: 'u' } })
        expect(waiting.states.listing).toBe('waiting')
        expect(turnLabel(waiting)).toBe('Wartet auf das Katalog-Team')
        const listed = shareProgress({ bundle: { state: 'on-base', verification: verified }, catalog: { state: 'listed' } })
        expect(listed.finished).toBe(true)
        expect(listed.active).toBeUndefined()
        expect(turnLabel(listed)).toBeUndefined()
    })

    it('stops at the catalogue step, with the reason, when the merged state cannot be confirmed', () => {
        const progress = shareProgress({ bundle: { state: 'on-base', verification: { state: 'changed-after-merge' } }, catalog: { state: 'none' } })
        expect(progress.states.catalog).toBe('blocked')
        expect(progress.blockedBy).toContain('nach der Prüfung geändert')
        expect(turnLabel(progress)).toBe('Du bist dran')
    })

    it('blames nobody on the page when no catalogue is set up', () => {
        const progress = shareProgress({ bundle: { state: 'on-base', verification: verified }, catalog: { state: 'unconfigured' } })
        expect(progress.states.catalog).toBe('blocked')
        expect(turnLabel(progress)).toBeUndefined()
    })

    it('counts a version replaced by a NEWER one, or closed, as finished', () => {
        const replaced = shareProgress({
            version: '1.0.0',
            bundleMrState: 'merged',
            bundle: { state: 'none', reason: 'other-version', onBase: { id: 'urn:x:usecase:a', version: '1.1.0' } },
        })
        expect(replaced.finished).toBe(true)
        expect(replaced.summary).toBe('Durch Version 1.1.0 ersetzt')
        expect(shareProgress({ bundleMrState: 'closed' }).finished).toBe(true)
    })

    it('asks nobody for a move when a merged package is missing or older on the base branch, and says why', () => {
        const missing = shareProgress({ version: '1.0.0', bundleMrState: 'merged', bundle: { state: 'none', reason: 'no-package' } })
        expect(missing.finished).toBe(true)
        expect(missing.states.catalog).toBe('blocked')
        expect(missing.blockedBy).toContain('nicht mehr im Ablageort')
        expect(missing.summary).toBe('Paket angenommen, aber nicht mehr im Ablageort')
        expect(turnLabel(missing)).toBeUndefined()

        const older = shareProgress({
            version: '1.1.0',
            bundleMrState: 'merged',
            bundle: { state: 'none', reason: 'other-version', onBase: { id: 'urn:x:usecase:a', version: '1.0.0' } },
        })
        expect(older.finished).toBe(true)
        expect(older.blockedBy).toContain('1.0.0 statt 1.1.0')

        const noBranch = shareProgress({ bundleMrState: 'merged', bundle: { state: 'none', reason: 'no-base-branch', detail: 'Im Ablageort fehlt „main“' } })
        expect(noBranch.blockedBy).toBe('Im Ablageort fehlt „main“ - das richtet der Betrieb ein.')
    })

    it('names a merge request the marketplace closed itself as withdrawn', () => {
        expect(shareProgress({ bundleMrState: 'closed', withdrawn: true })).toMatchObject({ finished: true, summary: 'Zurückgezogen' })
        expect(shareProgress({ bundleMrState: 'closed' }).summary).toBe('Nicht angenommen')
    })

    it('is finished with a version the catalogue team took out, and offers no catalogue step for it', () => {
        const deleted = shareProgress({ version: '1.0.2', bundleMrState: 'merged', bundle: { state: 'on-base', verification: verified }, catalog: { state: 'withdrawn', takenOut: { version: '1.0.2' } } })
        expect(deleted).toMatchObject({ finished: true, summary: 'Aus dem Katalog genommen' })
        expect(deleted.states.catalog).toBe('blocked')
        expect(deleted.active).toBeUndefined()
        expect(turnLabel(deleted)).toBeUndefined()

        const revoked = shareProgress({
            version: '1.0.2',
            bundleMrState: 'merged',
            // Even a package changed after the merge does not ask for a look any more.
            bundle: { state: 'on-base', verification: { state: 'changed-after-merge' } },
            catalog: { state: 'withdrawn', takenOut: { version: '1.0.2', reason: 'Datenquelle abgeschaltet.' } },
        })
        expect(revoked).toMatchObject({ finished: true, summary: 'Aus dem Katalog genommen - Datenquelle abgeschaltet' })
        expect(revoked.blockedBy).toBe('Diese Version kommt nicht noch einmal in den Katalog.')

        // A revoked row shuts out the whole entry: a higher version was never there, so "nicht noch einmal" would be wrong.
        const wholeEntry = shareProgress({ version: '1.1.0', bundleMrState: 'merged', bundle: { state: 'on-base', verification: verified }, catalog: { state: 'withdrawn', takenOut: { version: '1.0.2' } } })
        expect(wholeEntry).toMatchObject({ finished: true, summary: 'Aus dem Katalog genommen' })
        expect(wholeEntry.blockedBy).toBe('Herausgenommen ist der ganze Eintrag: auch eine neue Version kommt erst in den Katalog, wenn das Katalog-Team ihn wieder freigibt.')
    })

    it('asks the person to withdraw an open proposal that would bring a taken-out version back', () => {
        const progress = shareProgress({
            version: '1.0.2',
            bundleMrState: 'merged',
            bundle: { state: 'on-base', verification: verified },
            catalog: { state: 'mr-open', mrUrl: 'u/27', takenOut: { version: '1.0.2' }, bringsBack: true },
        })
        expect(progress).toMatchObject({ finished: false, active: 'listing', turn: 'you', summary: 'Katalog-Eintrag in Prüfung - bringt einen herausgenommenen Eintrag zurück' })
        expect(progress.states.listing).toBe('blocked')
        expect(turnLabel(progress)).toBe('Du bist dran')
    })

    it('does not offer to propose a version again that was in the catalogue, but does a higher one', () => {
        const usedUp = shareProgress({ version: '1.0.2', catalog: { state: 'withdrawn', takenOut: { version: '1.0.2' } } })
        expect(usedUp).toMatchObject({ finished: true, summary: 'Aus dem Katalog genommen' })
        expect(usedUp.states.propose).toBe('blocked')
        const higher = shareProgress({ version: '1.1.0', catalog: { state: 'none', takenOut: { version: '1.0.2' } } })
        expect(higher.states.propose).toBe('current')
    })

    it('tells who took a version out, why, and what to do before the next one', () => {
        expect(takenOutNotice({ version: '1.0.2' })).toBe('Das Katalog-Team hat Version 1.0.2 aus dem Katalog genommen. Frag dort nach, bevor du eine neue Version teilst.')
        // One full stop, whether or not the reason brings its own.
        for (const reason of ['Datenquelle abgeschaltet', 'Datenquelle abgeschaltet.']) {
            expect(takenOutNotice({ version: '1.0.2', reason })).toBe(
                'Das Katalog-Team hat Version 1.0.2 aus dem Katalog genommen. Grund: Datenquelle abgeschaltet. Frag dort nach, bevor du eine neue Version teilst.',
            )
        }
    })

    it('waits for the catalogue team while a removal is proposed, instead of asking for the catalogue entry', () => {
        const progress = shareProgress({
            bundleMrState: 'merged',
            bundle: { state: 'on-base', verification: verified, removal: { state: 'opened', mrUrl: 'u/remove' } },
            catalog: { state: 'none' },
        })
        expect(progress).toMatchObject({ removal: 'pending', finished: false, summary: 'Entfernen vorgeschlagen' })
        expect(progress.active).toBeUndefined()
        expect(progress.states.catalog).toBe('later')
        expect(turnLabel(progress)).toBe('Wartet auf das Katalog-Team')
    })

    it('is finished once the removal is merged and the version gone, and back when it was shared again', () => {
        const removed = shareProgress({
            version: '1.0.0',
            bundleMrState: 'merged',
            bundle: { state: 'none', reason: 'no-package', removal: { state: 'merged', mrUrl: 'u/remove' } },
        })
        expect(removed).toMatchObject({ removal: 'done', finished: true, summary: 'Paket entfernt' })
        expect(turnLabel(removed)).toBeUndefined()

        const back = shareProgress({
            bundleMrState: 'merged',
            bundle: { state: 'on-base', verification: verified, removal: { state: 'merged', mrUrl: 'u/remove' } },
            catalog: { state: 'none' },
        })
        expect(back.states.catalog).toBe('current')
        expect(back.removal).toBeUndefined()

        // A new proposal of the version: the removal is history, whatever its state.
        const proposedAgain = shareProgress({ bundle: { state: 'mr-open' } })
        expect(proposedAgain.active).toBe('review')
        expect(proposedAgain.removal).toBeUndefined()
    })

    it('never resets a version the catalogue team turned down: the stage keeps the "no", and nothing is proposed again (P1, U8)', () => {
        const declined = { iid: 31, mrUrl: 'u/31', closedAt: '2026-10-22T10:00:00Z', reason: { kind: 'none' as const } }
        // The package, as the wizard reads it for this version alone, and as the listing reads it.
        for (const facts of [{ bundle: { state: 'none' as const, reason: 'no-package' as const, declined } }, { bundleMrState: 'closed' }]) {
            const progress = shareProgress({ version: '1.0.0', ...facts })
            expect(progress).toMatchObject({ states: { propose: 'done', review: 'declined', catalog: 'later', listing: 'later' }, active: 'review', turn: 'you', finished: true, summary: 'Nicht angenommen' })
            // Not "Zur Prüfung einreichen" again: the propose stage is behind it.
            expect(progress.states.propose).not.toBe('current')
        }
        // Withdrawn by the person: the same version may be submitted again (R8).
        expect(shareProgress({ bundleMrState: 'closed', withdrawn: true })).toMatchObject({ states: { propose: 'later' }, summary: 'Zurückgezogen' })
        expect(shareProgress({ version: '1.0.0', bundle: { state: 'none', reason: 'no-package' } }).states.propose).toBe('current')

        // The entry (!31, !32): the package stays accepted, the entry stage keeps the "no", and no catalogue step is offered.
        const entry = shareProgress({ version: '1.1.4', bundleMrState: 'merged', bundle: { state: 'on-base', verification: verified }, catalog: { state: 'declined', mrUrl: 'u/32', declined } })
        expect(entry).toMatchObject({ states: { propose: 'done', review: 'done', catalog: 'done', listing: 'declined' }, active: 'listing', turn: 'you', finished: true })
        expect(entry.summary).toBe('Paket angenommen, Katalog-Eintrag nicht angenommen')
    })

    it('compares plain versions only', () => {
        expect(isNewerVersion('1.10.0', '1.9.3')).toBe(true)
        expect(isNewerVersion('1.0.0', '1.0.0')).toBe(false)
        expect(isNewerVersion('0.9.9', '1.0.0')).toBe(false)
        expect(isNewerVersion('2.0.0-rc.1', '1.0.0')).toBe(false)
    })
})

describe('nextPatch', () => {
    it('suggests one step above a used-up version, and a first version for anything else', () => {
        expect(nextPatch('1.0.2')).toBe('1.0.3')
        expect(nextPatch('1.1.9')).toBe('1.1.10')
        expect(nextPatch('beta')).toBe('1.0.0')
    })
})

describe('the wizard’s words for a "no" (2026-10-22, 3.3)', () => {
    const no = { iid: 14, mrUrl: 'https://gitlab.example/-/merge_requests/14', closedAt: '2026-10-21T10:00:00Z', closedBy: 'spaudanjo', reason: { kind: 'given' as const, text: 'Bitte mit Lizenz.' } }

    it('says at the package review who said no and when, their words, and the higher version to take (S1)', () => {
        expect(declinedStage('review', no, '1.0.0')).toEqual({
            who: 'Das Katalog-Team - nicht angenommen am 21.10.',
            reason: 'Grund (spaudanjo): „Bitte mit Lizenz.“',
            next: 'Für die überarbeitete Fassung trag im Steckbrief eine höhere Version ein, zum Beispiel 1.0.1.',
        })
    })

    it('says at the entry review that a different entry is a new version, and tells a close through the account as one (S5, S10)', () => {
        expect(declinedStage('listing', { ...no, viaMarketplace: true, reason: { kind: 'none' } }, '1.1.4')).toEqual({
            who: 'Über das Marktplatz-Konto geschlossen am 21.10. - gilt als nicht angenommen',
            reason: 'Ohne Begründung.',
            next: 'Der Eintrag entsteht aus dem angenommenen Paket. Für einen anderen Eintrag teilst du eine neue Version, die wieder geprüft wird.',
        })
    })

    it('says that a removal turned down leaves the package accepted (S8)', () => {
        // In the note's words (3.3, S8): who decided first.
        expect(removalDeclinedNotice(no)).toBe('Das Katalog-Team hat das Entfernen am 21.10. nicht angenommen - das Paket bleibt angenommen. Grund (spaudanjo): „Bitte mit Lizenz.“')
        expect(removalDeclinedNotice({ ...no, viaMarketplace: true, reason: { kind: 'none' } })).toBe(
            'Das Entfernen wurde am 21.10. nicht angenommen (über das Marktplatz-Konto geschlossen) - das Paket bleibt angenommen. Ohne Begründung.',
        )
    })

    it('warns that a new version from the dataset writes over what the team changed in review (S3)', () => {
        expect(reviewChangeNotice('1.1.4')).toBe(
            'Bei der Prüfung von 1.1.4 hat das Katalog-Team etwas geändert. Eine neue Version aus dem Datensatz überschreibt das - übernimm die Änderung vorher auf der Instanz.',
        )
    })
})
