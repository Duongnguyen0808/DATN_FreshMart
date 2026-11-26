import React, { useState } from 'react';
import {
  View,
  TextInput,
  Text,
  StyleSheet,
  TextInputProps,
  TouchableOpacity,
  ViewStyle,
} from 'react-native';
import { Colors, Radius, Typography } from '../../constants/theme';
import { Ionicons } from '@expo/vector-icons';

interface InputProps extends TextInputProps {
  label?: string;
  error?: string;
  leftIcon?: keyof typeof Ionicons.glyphMap;
  containerStyle?: ViewStyle;
}

export function Input({
  label,
  error,
  leftIcon,
  secureTextEntry,
  containerStyle,
  style,
  ...rest
}: InputProps) {
  const [isFocused, setIsFocused] = useState(false);
  const [isSecure, setIsSecure] = useState(secureTextEntry);

  return (
    <View style={[styles.container, containerStyle]}>
      {label && <Text style={styles.label}>{label}</Text>}
      <View
        style={[
          styles.inputWrapper,
          rest.multiline && styles.multilineWrapper,
          isFocused && styles.focused,
          !!error && styles.errorWrapper,
        ]}
      >
        {leftIcon && (
          <Ionicons
            name={leftIcon}
            size={18}
            color={isFocused ? Colors.primary : Colors.muted}
            style={styles.icon}
          />
        )}
        <TextInput
          placeholderTextColor={Colors.textLight}
          style={[styles.input, rest.multiline && styles.multilineInput, style]}
          secureTextEntry={isSecure}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          {...rest}
        />
        {secureTextEntry && (
          <TouchableOpacity
            onPress={() => setIsSecure(!isSecure)}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons
              name={isSecure ? 'eye-off-outline' : 'eye-outline'}
              size={18}
              color={Colors.muted}
            />
          </TouchableOpacity>
        )}
      </View>
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: 16,
  },
  label: {
    fontSize: Typography.sizes.body,
    fontWeight: Typography.weights.medium,
    color: Colors.text,
    marginBottom: 6,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: Colors.border,
    borderRadius: Radius.control,
    backgroundColor: '#ffffff',
    paddingHorizontal: 12,
    height: 48,
  },
  multilineWrapper: {
    height: undefined,
    minHeight: 92,
    alignItems: 'flex-start',
    paddingVertical: 10,
  },
  multilineInput: {
    textAlignVertical: 'top',
    paddingTop: 0,
    minHeight: 70,
  },
  focused: {
    borderColor: Colors.primary,
    backgroundColor: '#ffffff',
  },
  errorWrapper: {
    borderColor: Colors.danger,
  },
  icon: {
    marginRight: 8,
  },
  input: {
    flex: 1,
    fontSize: Typography.sizes.body,
    color: Colors.text,
    height: '100%',
  },
  errorText: {
    fontSize: Typography.sizes.caption,
    color: Colors.danger,
    marginTop: 4,
  },
});
