/**
 * Minimal host showing the one integration point: a button that opens the
 * migration flow in a modal. Copy `src/modules/gnm/` into your real app and
 * do this from wherever your "Update contacts" button lives.
 */

import React, { useState } from 'react';
import { Modal, Pressable, SafeAreaView, Text, View } from 'react-native';
import { GNMScreen, configureGNM } from '../src/modules/gnm';

configureGNM({
  // Point at your own hosted copy of the rules JSON in production.
  rulesUrl: 'https://api.oceanbrown.gm/api/migration-rules',
  productName: 'Comium Number Migrator',
  // operatorFilter: ['COMIUM'], // only migrate Comium numbers
});

export default function App() {
  const [open, setOpen] = useState(false);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#F6F6F7' }}>
      <View style={{ flex: 1, padding: 24, justifyContent: 'center' }}>
        <Text style={{ fontSize: 22, fontWeight: '800', color: '#111921', marginBottom: 8 }}>
          Comium
        </Text>
        <Text style={{ color: '#5B6570', marginBottom: 24 }}>
          Numbers are moving from 7 to 9 digits. Update your saved contacts in one step.
        </Text>

        <Pressable
          onPress={() => setOpen(true)}
          style={{
            backgroundColor: '#E1251B',
            borderRadius: 14,
            minHeight: 52,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text style={{ color: '#fff', fontWeight: '800', fontSize: 16 }}>Update contacts</Text>
        </Pressable>
      </View>

      <Modal visible={open} animationType="slide" onRequestClose={() => setOpen(false)}>
        <GNMScreen
          onClose={() => setOpen(false)}
          onComplete={(r) => console.log('migration result', r)}
        />
      </Modal>
    </SafeAreaView>
  );
}
