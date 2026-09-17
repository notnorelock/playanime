package notify

import (
	"fmt"
	"log"
	"strings"

	"github.com/bwmarrin/discordgo"
)

// loadStageEmojis resolves names (a pipeline-stage -> custom-guild-emoji-
// name map, from config.DiscordBotConfig.StageEmojis) against guildID's
// actual custom emojis, returning a stage -> Discord mention-syntax map
// (e.g. "<:job_progress:123456789012345678>", or "<a:...:...>" for an
// animated emoji — the exact syntax Discord requires to render a custom
// emoji inside a message/embed, as opposed to just printing its name).
//
// A configured name with no matching guild emoji is logged and left out of
// the returned map — callers fall back to a plain Unicode emoji per stage,
// so a typo'd config value degrades visibly (a boring but present ✅/🟡
// instead of the custom one) rather than silently blanking a field.
func loadStageEmojis(s *discordgo.Session, guildID string, names map[string]string) (map[string]string, error) {
	if len(names) == 0 {
		return nil, nil
	}

	emojis, err := s.GuildEmojis(guildID)
	if err != nil {
		return nil, fmt.Errorf("listing guild emojis: %w", err)
	}

	byName := make(map[string]*discordgo.Emoji, len(emojis))
	for _, e := range emojis {
		byName[strings.ToLower(e.Name)] = e
	}

	resolved := make(map[string]string, len(names))
	for stage, emojiName := range names {
		found, ok := byName[strings.ToLower(emojiName)]
		if !ok {
			log.Printf("stage emoji %q for stage %q not found in guild %s — falling back to a plain emoji for this stage", emojiName, stage, guildID)
			continue
		}

		if found.Animated {
			resolved[stage] = fmt.Sprintf("<a:%s:%s>", found.Name, found.ID)
		} else {
			resolved[stage] = fmt.Sprintf("<:%s:%s>", found.Name, found.ID)
		}
	}

	return resolved, nil
}
